import { Hono } from "hono";
import { desc, eq, like, or } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { setJWTCookie } from "../core/hono-middleware";
import { adminOnly } from "../core/route-boundaries";
import { emailVerifications, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../utils/password";
import {
    consumeEmailVerification,
    createEmailVerification,
    isMailReady,
    isValidEmail,
    normalizeEmail,
    sendVerificationEmail,
} from "../utils/email-verification";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    InternalServerError,
    NotFoundError,
    ServiceUnavailableError,
    RateLimitError
} from "../errors";

/** 用户名只允许非空、去首尾空格后不超过 32 个字符；保持与注册接口一致。 */
function normalizeUsername(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** 把数据库用户转换成前端需要的资料结构，不返回密码哈希。 */
function serializeProfile(user: {
    id: number;
    username: string;
    avatar: string | null;
    email: string | null;
    password: string | null;
    permission: number | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        email: user.email,
        hasPassword: Boolean(user.password),
        permission: user.permission === 1,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

export function UserService(): Hono {
    const app = new Hono();

    // GET /user/github - Redirect to GitHub OAuth
    app.get("/github", async (c: AppContext) => {
        const oauth2 = c.get('oauth2');

        if (!oauth2) {
            throw new BadRequestError('GitHub OAuth is not configured');
        }

        const referer = c.req.header('referer');

        if (!referer) {
            throw new BadRequestError('Referer header is required');
        }

        // Build callback URL from referer
        const refererUrl = new URL(referer);
        const callbackUrl = new URL('/callback', refererUrl.origin);

        setCookie(c, 'redirect_to', callbackUrl.toString(), {
            path: '/',
        });

        const genState = await profileAsync(c, 'user_oauth_state', () => Promise.resolve(oauth2.generateState()));
        setCookie(c, 'state', genState, {
            path: '/',
        });

        return c.redirect(oauth2.createRedirectUrl(genState, "GitHub"), 302);
    });

    // GET /user/github/callback - GitHub OAuth callback
    app.get("/github/callback", async (c: AppContext) => {
        const oauth2 = c.get('oauth2');
        const jwt = c.get('jwt');
        const db = c.get('db');

        if (!oauth2) {
            throw new BadRequestError('GitHub OAuth is not configured');
        }

        const query = c.req.query();
        const stateCookie = getCookie(c, 'state');

        console.log('param_state', query.state);
        console.log('cookie_state', stateCookie);

        // Verify state to prevent CSRF attacks
        if (query.state !== stateCookie) {
            throw new BadRequestError('Invalid state parameter');
        }

        // Clear state cookie
        deleteCookie(c, 'state');

        // Exchange code for access token
        const gh_token = await profileAsync(c, 'user_oauth_authorize', () => oauth2.authorize("GitHub", query.code));
        if (!gh_token) {
            throw new BadRequestError('Failed to authorize with GitHub');
        }

        // Request https://api.github.com/user for user info
        const response = await profileAsync(c, 'user_github_fetch', () => fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${gh_token.accessToken}`,
                Accept: "application/json",
                "User-Agent": "rin"
            },
        }));

        const user: any = await profileAsync(c, 'user_github_parse', () => response.json());
        const profile: {
            openid: string;
            username: string;
            avatar: string;
            permission: number | null;
        } = {
            openid: user.id,
            username: user.name || user.login,
            avatar: user.avatar_url,
            permission: 0
        };

        let authToken: string | undefined;

        // Check if user exists
        const existingUser = await profileAsync(c, 'user_existing_lookup', () => db.query.users.findFirst({
            where: eq(users.openid, profile.openid)
        }));

        if (existingUser) {
            profile.permission = existingUser.permission;
            await profileAsync(c, 'user_existing_update', () => db.update(users).set(profile).where(eq(users.id, existingUser.id)));
            authToken = await profileAsync(c, 'user_existing_token', () => jwt.sign({ id: existingUser.id }));
            setJWTCookie(c, authToken);
            // Store token in cookie for frontend to read (not HttpOnly)
            setCookie(c, 'auth_token', authToken, {
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
                path: '/',
                sameSite: 'Lax',
            });
        } else {
            // If no user exists, check if this is the first user
            const anyUserCheck = await profileAsync(c, 'user_first_lookup', () => db.query.users.findMany({ limit: 1 }));
            if (anyUserCheck.length === 0) {
                profile.permission = 1;
            }

            const result = await profileAsync(c, 'user_insert', () => db.insert(users).values(profile).returning({ insertedId: users.id }));
            if (!result || result.length === 0) {
                throw new InternalServerError('Failed to register user');
            }

            authToken = await profileAsync(c, 'user_insert_token', () => jwt.sign({ id: result[0].insertedId }));
            setJWTCookie(c, authToken);
            // Store token in cookie for frontend to read (not HttpOnly)
            setCookie(c, 'auth_token', authToken, {
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
                path: '/',
                sameSite: 'Lax',
            });
        }

        const redirectTo = getCookie(c, 'redirect_to');
        const redirect_url = new URL(redirectTo || '/');
        // Add token to URL for frontend to store (for cross-domain auth)
        if (authToken) {
            redirect_url.searchParams.set('token', authToken);
        }
        return c.redirect(redirect_url.toString(), 302);
    });

    // GET /user/profile - Get user profile
    app.get('/profile', async (c: AppContext) => {
        const uid = c.get('uid');
        const db = c.get('db');

        if (!uid) {
            throw new ForbiddenError('Authentication required');
        }

        const user = await profileAsync(c, 'user_profile_lookup', () => db.query.users.findFirst({ where: eq(users.id, uid) }));
        if (!user) {
            throw new NotFoundError('User');
        }

        return c.json(serializeProfile(user));
    });

    // POST /user/email/code - 为登录用户更换邮箱时发送验证码
    app.post('/email/code', async (c: AppContext) => {
        const uid = c.get('uid');
        const db = c.get('db');

        if (!uid) {
            throw new ForbiddenError('Authentication required');
        }

        const body = await profileAsync(c, 'user_email_code_parse', () => c.req.json()) as { email?: unknown };
        const email = normalizeEmail(body.email);
        if (!isValidEmail(email)) {
            throw new BadRequestError('A valid email address is required');
        }

        const user = await profileAsync(c, 'user_email_code_user_lookup', () => db.query.users.findFirst({
            where: eq(users.id, uid),
        }));
        if (!user) {
            throw new NotFoundError('User');
        }
        if (user.email === email) {
            throw new BadRequestError('New email is the same as the current email');
        }

        const existing = await profileAsync(c, 'user_email_code_email_lookup', () => db.query.users.findFirst({
            where: eq(users.email, email),
        }));
        if (existing && existing.id !== uid) {
            throw new ConflictError('Email is already registered');
        }

        const serverConfig = c.get('serverConfig');
        if (!serverConfig || !(await isMailReady(serverConfig))) {
            throw new ServiceUnavailableError('Email service is not configured');
        }

        const env = c.env;
        if (!env.JWT_SECRET) {
            throw new InternalServerError('JWT secret is not configured');
        }

        const verification = await profileAsync(c, 'user_email_code_create', () => createEmailVerification(
            db,
            email,
            "email_change",
            env.JWT_SECRET,
        ));

        const clientConfig = c.get('clientConfig');
        const siteName = String((await clientConfig?.get("site.name")) || "Rin");
        const sendResult = await profileAsync(c, 'user_email_code_send', () => sendVerificationEmail(
            serverConfig,
            email,
            verification.code,
            "email_change",
            siteName,
        ));

        if (!sendResult.success) {
            await db.delete(emailVerifications).where(eq(emailVerifications.id, verification.id));
            throw new ServiceUnavailableError(sendResult.error || 'Failed to send verification email');
        }

        return c.json({
            success: true,
            expiresIn: verification.expiresIn,
            resendAfter: 60,
        });
    });

    // POST /user/logout - Logout user
    app.post('/logout', async (c: AppContext) => {
        deleteCookie(c, 'token', {
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
        });
        deleteCookie(c, 'auth_token', {
            path: '/',
            sameSite: 'Lax',
        });
        return c.json({ success: true });
    });

    // GET /user/admin/list - 管理员查看用户列表，不返回密码哈希
    app.get('/admin/list', adminOnly(async (c: AppContext) => {
        const db = c.get('db');
        const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query('limit') || '20', 10) || 20));
        const search = (c.req.query('search') || '').trim().slice(0, 64);

        const where = search
            ? or(
                like(users.username, `%${search}%`),
                like(users.email, `%${search}%`),
            )
            : undefined;

        const rows = await profileAsync(c, 'user_admin_list', () => db.query.users.findMany({
            where,
            orderBy: [desc(users.createdAt)],
            limit: limit + 1,
            offset: (page - 1) * limit,
        }));

        const hasNext = rows.length > limit;
        const items = rows.slice(0, limit).map((user) => ({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            email: user.email,
            emailVerified: Boolean(user.emailVerifiedAt),
            hasPassword: Boolean(user.password),
            permission: user.permission === 1,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        }));

        return c.json({
            data: items,
            page,
            limit,
            hasNext,
            search,
        });
    }, { format: 'json' }));

    // PUT /user/admin/:id - 管理员编辑指定用户资料或重置密码
    app.put('/admin/:id', adminOnly(async (c: AppContext) => {
        const db = c.get('db');
        const actorId = c.get('uid');
        const targetId = Number.parseInt(c.req.param('id') || '', 10);
        if (!Number.isInteger(targetId) || targetId <= 0) {
            throw new BadRequestError('Invalid user id');
        }

        const body = await profileAsync(c, 'user_admin_update_parse', () => c.req.json()) as {
            username?: unknown;
            avatar?: string | null;
            email?: string | null;
            newPassword?: unknown;
            permission?: unknown;
        };

        const hasUsername = body.username !== undefined;
        const hasAvatar = body.avatar !== undefined;
        const hasEmail = body.email !== undefined;
        const hasNewPassword = body.newPassword !== undefined && String(body.newPassword).length > 0;
        const hasPermission = body.permission !== undefined;

        if (!hasUsername && !hasAvatar && !hasEmail && !hasNewPassword && !hasPermission) {
            throw new BadRequestError('At least one user field is required');
        }

        const target = await profileAsync(c, 'user_admin_update_lookup', () => db.query.users.findFirst({
            where: eq(users.id, targetId),
        }));
        if (!target) {
            throw new NotFoundError('User');
        }

        const updateData: {
            username?: string;
            avatar?: string | null;
            email?: string | null;
            emailVerifiedAt?: Date | null;
            password?: string;
            permission?: number;
            updatedAt?: Date;
        } = {};

        if (hasUsername) {
            const nextUsername = normalizeUsername(body.username);
            if (nextUsername.length < 1 || nextUsername.length > 32) {
                throw new BadRequestError('Username must be between 1 and 32 characters');
            }
            if (nextUsername !== target.username) {
                const existing = await profileAsync(c, 'user_admin_update_username_lookup', () => db.query.users.findFirst({
                    where: eq(users.username, nextUsername),
                }));
                if (existing && existing.id !== targetId) {
                    throw new ConflictError('Username is already taken');
                }
                if (c.env.ADMIN_USERNAME && nextUsername === c.env.ADMIN_USERNAME && target.openid !== 'admin') {
                    throw new ConflictError('Username is reserved');
                }
                updateData.username = nextUsername;
            }
        }

        if (hasAvatar) {
            updateData.avatar = body.avatar || null;
        }

        if (hasEmail) {
            const rawEmail = normalizeEmail(body.email);
            if (!rawEmail) {
                // 管理员显式留空表示解除邮箱绑定。
                if (target.email !== null) {
                    updateData.email = null;
                    updateData.emailVerifiedAt = null;
                }
            } else {
                if (!isValidEmail(rawEmail)) {
                    throw new BadRequestError('A valid email address is required');
                }
                if (rawEmail !== target.email) {
                    const existing = await profileAsync(c, 'user_admin_update_email_lookup', () => db.query.users.findFirst({
                        where: eq(users.email, rawEmail),
                    }));
                    if (existing && existing.id !== targetId) {
                        throw new ConflictError('Email is already registered');
                    }
                    // 管理员直接编辑邮箱时视为已由管理员确认，记录验证时间。
                    updateData.email = rawEmail;
                    updateData.emailVerifiedAt = new Date();
                }
            }
        }

        if (hasNewPassword) {
            const nextPassword = String(body.newPassword);
            if (nextPassword.length < 8 || nextPassword.length > 128) {
                throw new BadRequestError('Password must be between 8 and 128 characters');
            }
            updateData.password = await profileAsync(c, 'user_admin_update_password_hash', () => hashPassword(nextPassword));
        }

        if (hasPermission) {
            if (typeof body.permission !== 'boolean') {
                throw new BadRequestError('Permission must be a boolean');
            }
            const nextPermission = body.permission ? 1 : 0;
            if (targetId === actorId && nextPermission !== target.permission) {
                throw new BadRequestError('Cannot change your own permission');
            }
            if (nextPermission !== target.permission) {
                updateData.permission = nextPermission;
            }
        }

        if (Object.keys(updateData).length === 0) {
            throw new BadRequestError('No user changes were provided');
        }

        const updatedAt = new Date();
        updateData.updatedAt = updatedAt;
        await profileAsync(c, 'user_admin_update_write', () => db.update(users).set(updateData).where(eq(users.id, targetId)));

        const updated = { ...target, ...updateData, updatedAt };
        return c.json({
            success: true,
            user: {
                id: updated.id,
                username: updated.username,
                avatar: updated.avatar,
                email: updated.email,
                emailVerified: Boolean(updated.emailVerifiedAt),
                hasPassword: Boolean(updated.password),
                permission: updated.permission === 1,
                createdAt: updated.createdAt,
                updatedAt,
            },
        });
    }, { format: 'json' }));

    // PUT /user/profile - 更新用户名、头像、邮箱和密码
    app.put('/profile', async (c: AppContext) => {
        const uid = c.get('uid');
        const db = c.get('db');
        const body = await profileAsync(c, 'user_profile_parse', () => c.req.json());

        if (!uid) {
            throw new ForbiddenError('Authentication required');
        }

        const {
            username,
            avatar,
            email,
            emailCode,
            currentPassword,
            newPassword,
        } = body as {
            username?: unknown;
            avatar?: string | null;
            email?: unknown;
            emailCode?: unknown;
            currentPassword?: unknown;
            newPassword?: unknown;
        };

        const hasUsername = username !== undefined;
        const hasAvatar = avatar !== undefined;
        const hasEmail = email !== undefined;
        const hasNewPassword = newPassword !== undefined && String(newPassword).length > 0;

        if (!hasUsername && !hasAvatar && !hasEmail && !hasNewPassword) {
            throw new BadRequestError('At least one profile field is required');
        }

        const user = await profileAsync(c, 'user_profile_lookup', () => db.query.users.findFirst({
            where: eq(users.id, uid),
        }));
        if (!user) {
            throw new NotFoundError('User');
        }

        const updateData: {
            username?: string;
            avatar?: string | null;
            email?: string;
            emailVerifiedAt?: Date;
            password?: string;
        } = {};

        if (hasUsername) {
            const nextUsername = normalizeUsername(username);
            if (nextUsername.length < 1 || nextUsername.length > 32) {
                throw new BadRequestError('Username must be between 1 and 32 characters');
            }

            if (nextUsername !== user.username) {
                const existing = await profileAsync(c, 'user_profile_username_lookup', () => db.query.users.findFirst({
                    where: eq(users.username, nextUsername),
                }));
                if (existing && existing.id !== uid) {
                    throw new ConflictError('Username is already taken');
                }
                if (c.env.ADMIN_USERNAME && nextUsername === c.env.ADMIN_USERNAME && user.openid !== "admin") {
                    throw new ConflictError('Username is reserved');
                }
                updateData.username = nextUsername;
            }
        }

        if (hasAvatar) {
            // 允许显式传入 null 清空头像；空字符串也按清空处理。
            updateData.avatar = avatar || null;
        }

        if (hasEmail) {
            const nextEmail = normalizeEmail(email);
            if (!isValidEmail(nextEmail)) {
                throw new BadRequestError('A valid email address is required');
            }

            if (nextEmail !== user.email) {
                const existing = await profileAsync(c, 'user_profile_email_lookup', () => db.query.users.findFirst({
                    where: eq(users.email, nextEmail),
                }));
                if (existing && existing.id !== uid) {
                    throw new ConflictError('Email is already registered');
                }

                const code = typeof emailCode === "string" ? emailCode.trim() : "";
                if (!/^\d{6}$/.test(code)) {
                    throw new BadRequestError('Email verification code is required');
                }

                const env = c.env;
                if (!env.JWT_SECRET) {
                    throw new InternalServerError('JWT secret is not configured');
                }

                const verification = await profileAsync(c, 'user_profile_email_consume', () => consumeEmailVerification(
                    db,
                    nextEmail,
                    "email_change",
                    code,
                    env.JWT_SECRET,
                ));

                if (!verification.ok) {
                    if (verification.reason === "attempts") {
                        throw new RateLimitError('Too many verification attempts; request a new code');
                    }
                    throw new BadRequestError('Email verification code is invalid or expired');
                }

                updateData.email = nextEmail;
                updateData.emailVerifiedAt = new Date();
            }
        }

        if (hasNewPassword) {
            const nextPassword = String(newPassword);
            if (nextPassword.length < 8 || nextPassword.length > 128) {
                throw new BadRequestError('Password must be between 8 and 128 characters');
            }

            if (user.password) {
                const suppliedCurrent = typeof currentPassword === "string" ? currentPassword : "";
                if (!suppliedCurrent) {
                    throw new BadRequestError('Current password is required');
                }
                const valid = await profileAsync(c, 'user_profile_password_verify', () => verifyPassword(suppliedCurrent, user.password));
                if (!valid) {
                    throw new ForbiddenError('Current password is incorrect');
                }
            }

            updateData.password = await profileAsync(c, 'user_profile_password_hash', () => hashPassword(nextPassword));
        }

        if (Object.keys(updateData).length === 0) {
            throw new BadRequestError('No profile changes were provided');
        }

        await profileAsync(c, 'user_profile_update', () => db.update(users).set(updateData).where(eq(users.id, uid)));

        return c.json({
            success: true,
            username: updateData.username ?? user.username,
            email: updateData.email ?? user.email,
        });
    });

    return app;
}
