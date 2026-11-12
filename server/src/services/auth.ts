import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, Variables } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { setJWTCookie } from "../core/hono-middleware";
import { emailVerifications, users } from "../db/schema";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    InternalServerError,
    ServiceUnavailableError,
} from "../errors";
import {
    hashPassword,
    isLegacyPasswordHash,
    timingSafeEqual,
    verifyPassword,
} from "../utils/password";
import {
    consumeEmailVerification,
    createEmailVerification,
    EMAIL_CODE_MAX_ATTEMPTS,
    isMailReady,
    isValidEmail,
    normalizeEmail,
    sendVerificationEmail,
    type EmailVerificationPurpose,
} from "../utils/email-verification";

/** 管理端保存的注册开关可能是 boolean，也可能是旧配置里的字符串。 */
function normalizeConfigBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    if (typeof value === "number") return value !== 0;
    return Boolean(value);
}

async function isRegistrationEnabled(c: AppContext): Promise<boolean> {
    const clientConfig = c.get("clientConfig");
    if (!clientConfig) {
        return false;
    }
    return normalizeConfigBoolean(await clientConfig.getOrDefault("register.enabled", false));
}

async function getMailReadiness(c: AppContext) {
    const serverConfig = c.get("serverConfig");
    if (!serverConfig) {
        return false;
    }
    return isMailReady(serverConfig);
}

function assertRegistrationInput(input: {
    email?: unknown;
    username?: unknown;
    password?: unknown;
}) {
    const email = normalizeEmail(input.email);
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";

    if (!isValidEmail(email)) {
        throw new BadRequestError("A valid email address is required");
    }
    if (username.length < 1 || username.length > 32) {
        throw new BadRequestError("Username must be between 1 and 32 characters");
    }
    if (password.length < 8 || password.length > 128) {
        throw new BadRequestError("Password must be between 8 and 128 characters");
    }

    return { email, username, password };
}

function sessionResponse(user: {
    id: number;
    username: string;
    avatar: string | null;
    email: string | null;
    password: string | null;
    permission: number | null;
}, token: string) {
    return {
        success: true,
        token,
        user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            email: user.email,
            permission: user.permission === 1,
            hasPassword: Boolean(user.password),
        },
    };
}

export function PasswordAuthService(): Hono<{
        Bindings: Env;
        Variables: Variables;
    }> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // Login with username and password
    app.post("/login", async (c: AppContext) => {
        const jwt = c.get('jwt');
        const db = c.get('db');
        const env = c.env;

        const body = await profileAsync(c, 'auth_login_parse', () => c.req.json()) as { username?: string; password?: string };
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";

        if (!username || !password) {
            throw new BadRequestError('Username and password are required');
        }

        // 先按用户名查库；管理员和普通用户共用同一条密码校验路径。
        let user = await profileAsync(c, 'auth_user_lookup', () => db.query.users.findFirst({
            where: eq(users.username, username),
        }));

        if (!user) {
            // 首次部署时允许用环境变量创建管理员；之后管理员资料以数据库为准。
            const existingAdmin = await profileAsync(c, 'auth_admin_lookup', () => db.query.users.findFirst({
                where: eq(users.openid, "admin"),
            }));

            const adminUsername = env.ADMIN_USERNAME;
            const adminPassword = env.ADMIN_PASSWORD;

            if (!adminUsername || !adminPassword) {
                throw new BadRequestError('Admin credentials not configured');
            }

            if (existingAdmin || username !== adminUsername || !timingSafeEqual(password, adminPassword)) {
                throw new ForbiddenError('Invalid credentials');
            }

            const passwordHash = await profileAsync(c, 'auth_admin_hash', () => hashPassword(adminPassword));
            const result = await profileAsync(c, 'auth_admin_insert', () => db.insert(users).values({
                username: adminUsername,
                openid: "admin",
                avatar: "",
                permission: 1,
                password: passwordHash,
            }).returning({ insertedId: users.id }));

            if (!result || result.length === 0) {
                throw new InternalServerError('Failed to create admin user');
            }

            user = await profileAsync(c, 'auth_admin_reload', () => db.query.users.findFirst({
                where: eq(users.id, result[0].insertedId),
            }));

            if (!user) {
                throw new InternalServerError('Failed to get admin user');
            }
        } else {
            let valid = await profileAsync(c, 'auth_password_verify', () => verifyPassword(password, user?.password));

            // 兼容旧部署：如果管理员密码仍是旧版无盐哈希，允许用最新环境变量密码登录并顺手升级哈希。
            if (
                !valid
                && user.openid === "admin"
                && isLegacyPasswordHash(user.password)
                && env.ADMIN_PASSWORD
                && timingSafeEqual(password, env.ADMIN_PASSWORD)
            ) {
                valid = true;
            }

            if (!valid) {
                throw new ForbiddenError('Invalid credentials');
            }

            // 旧哈希只用于兼容；登录成功后升级为带盐 PBKDF2。
            if (isLegacyPasswordHash(user.password)) {
                const upgraded = await profileAsync(c, 'auth_password_upgrade', () => hashPassword(password));
                await profileAsync(c, 'auth_password_upgrade_save', () => db.update(users)
                    .set({ password: upgraded })
                    .where(eq(users.id, user!.id)));
                user = { ...user, password: upgraded };
            }
        }

        const token = await profileAsync(c, 'auth_token', () => jwt.sign({ id: user!.id }));
        setJWTCookie(c, token);

        return c.json(sessionResponse(user!, token));
    });

    // POST /auth/register/code - 发送注册邮箱验证码
    app.post("/register/code", async (c: AppContext) => {
        if (!(await isRegistrationEnabled(c))) {
            throw new ForbiddenError('Registration is disabled');
        }

        const body = await profileAsync(c, 'auth_register_code_parse', () => c.req.json()) as { email?: string };
        const email = normalizeEmail(body.email);
        if (!isValidEmail(email)) {
            throw new BadRequestError('A valid email address is required');
        }

        if (!(await getMailReadiness(c))) {
            throw new ServiceUnavailableError('Email service is not configured');
        }

        const db = c.get('db');
        const existing = await profileAsync(c, 'auth_register_email_lookup', () => db.query.users.findFirst({
            where: eq(users.email, email),
        }));
        if (existing) {
            throw new ConflictError('Email is already registered');
        }

        const env = c.env;
        if (!env.JWT_SECRET) {
            throw new InternalServerError('JWT secret is not configured');
        }

        const verification = await profileAsync(c, 'auth_register_code_create', () => createEmailVerification(
            db,
            email,
            "register",
            env.JWT_SECRET,
        ));

        const clientConfig = c.get('clientConfig');
        const siteName = String((await clientConfig?.get("site.name")) || "Rin");
        const serverConfig = c.get('serverConfig');
        if (!serverConfig) {
            throw new ServiceUnavailableError('Email service is not configured');
        }

        const sendResult = await profileAsync(c, 'auth_register_code_send', () => sendVerificationEmail(
            serverConfig,
            email,
            verification.code,
            "register",
            siteName,
        ));

        if (!sendResult.success) {
            // 发送失败时撤销本次验证码，避免数据库里留下用户无法收到的有效码。
            await db.delete(emailVerifications).where(eq(emailVerifications.id, verification.id));
            throw new ServiceUnavailableError(sendResult.error || 'Failed to send verification email');
        }

        return c.json({
            success: true,
            expiresIn: verification.expiresIn,
            resendAfter: 60,
            maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
        });
    });

    // POST /auth/register - 使用邮箱验证码完成注册并自动登录
    app.post("/register", async (c: AppContext) => {
        if (!(await isRegistrationEnabled(c))) {
            throw new ForbiddenError('Registration is disabled');
        }

        const body = await profileAsync(c, 'auth_register_parse', () => c.req.json()) as {
            email?: unknown;
            username?: unknown;
            password?: unknown;
            code?: unknown;
        };
        const { email, username, password } = assertRegistrationInput(body);
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!/^\d{6}$/.test(code)) {
            throw new BadRequestError('A 6-digit verification code is required');
        }

        const db = c.get('db');
        const existingEmail = await profileAsync(c, 'auth_register_email_lookup', () => db.query.users.findFirst({
            where: eq(users.email, email),
        }));
        if (existingEmail) {
            throw new ConflictError('Email is already registered');
        }

        const existingUsername = await profileAsync(c, 'auth_register_username_lookup', () => db.query.users.findFirst({
            where: eq(users.username, username),
        }));
        if (existingUsername) {
            throw new ConflictError('Username is already taken');
        }

        // 预留环境变量管理员用户名，避免管理员首次登录前被普通注册占用导致无法初始化。
        if (c.env.ADMIN_USERNAME && username === c.env.ADMIN_USERNAME) {
            throw new ConflictError('Username is reserved');
        }

        const env = c.env;
        if (!env.JWT_SECRET) {
            throw new InternalServerError('JWT secret is not configured');
        }

        const verification = await profileAsync(c, 'auth_register_code_consume', () => consumeEmailVerification(
            db,
            email,
            "register",
            code,
            env.JWT_SECRET,
        ));

        if (!verification.ok) {
            if (verification.reason === "attempts") {
                throw new ConflictError('Too many verification attempts; request a new code');
            }
            throw new BadRequestError('Verification code is invalid or expired');
        }

        const passwordHash = await profileAsync(c, 'auth_register_hash', () => hashPassword(password));

        let insertedId: number;
        try {
            const result = await profileAsync(c, 'auth_register_insert', () => db.insert(users).values({
                username,
                openid: `email:${crypto.randomUUID()}`,
                avatar: "",
                password: passwordHash,
                email,
                emailVerifiedAt: new Date(),
                permission: 0,
            }).returning({ insertedId: users.id }));

            if (!result || result.length === 0) {
                throw new InternalServerError('Failed to create user');
            }
            insertedId = result[0].insertedId;
        } catch (error) {
            if (error instanceof InternalServerError) {
                throw error;
            }
            throw new ConflictError('Email or username is already registered');
        }

        const user = await profileAsync(c, 'auth_register_reload', () => db.query.users.findFirst({
            where: eq(users.id, insertedId),
        }));
        if (!user) {
            throw new InternalServerError('Failed to load registered user');
        }

        const jwt = c.get('jwt');
        const token = await profileAsync(c, 'auth_register_token', () => jwt.sign({ id: user.id }));
        setJWTCookie(c, token);

        return c.json(sessionResponse(user, token), 201);
    });

    // Check whether login methods and email registration are available
    app.get("/status", async (c: AppContext) => {
        const env = c.env;
        const registerEnabled = await isRegistrationEnabled(c);
        const mailReady = await getMailReadiness(c);

        return c.json({
            github: !!(env.RIN_GITHUB_CLIENT_ID && env.RIN_GITHUB_CLIENT_SECRET),
            password: !!(env.ADMIN_USERNAME && env.ADMIN_PASSWORD),
            register: registerEnabled && mailReady,
        });
    });

    return app;
}
