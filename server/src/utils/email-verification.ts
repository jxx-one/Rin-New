import { and, desc, eq, isNull } from "drizzle-orm";
import { emailVerifications } from "../db/schema";
import { RateLimitError } from "../errors";
import { escapeHtml, resolveMailConfig, sendMail, type SendMailResult } from "../utils/mail";
import { timingSafeEqual } from "../utils/password";
import type { DB } from "../core/hono-types";

/** 验证码用途：注册新账号，或在登录后更换邮箱。 */
export type EmailVerificationPurpose = "register" | "email_change";

/** 邮箱验证码有效期：10 分钟。 */
export const EMAIL_CODE_TTL_SECONDS = 10 * 60;

/** 同一邮箱同一用途的发送冷却时间：60 秒，避免被用来反复轰炸邮箱。 */
export const EMAIL_CODE_RESEND_SECONDS = 60;

/** 单个验证码允许输错的次数。 */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

type ConfigReader = {
    get(key: string): Promise<unknown>;
};

/** 去除首尾空格并统一转小写，保证邮箱唯一性与展示一致。 */
export function normalizeEmail(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** 轻量邮箱格式校验，足以拦截明显非法输入；真实可达性由验证码证明。 */
export function isValidEmail(email: string): boolean {
    return email.length > 0
        && email.length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** 生成 6 位数字验证码，使用 Web Crypto 随机源。 */
export function generateEmailCode(): string {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    return random.toString().padStart(6, "0");
}

/**
 * 使用 JWT_SECRET 作为密钥计算验证码 HMAC。
 * 验证码只有 6 位，单纯 SHA-256 在数据库泄露时可被穷举，因此这里使用带密钥的 HMAC。
 */
export async function hashEmailCode(
    secret: string,
    email: string,
    purpose: EmailVerificationPurpose,
    code: string,
): Promise<string> {
    if (!secret) {
        throw new Error("JWT_SECRET is required for email verification");
    }

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${email}\n${purpose}\n${code}`),
    );

    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 校验验证码哈希；输入与数据库值都按小写比较。 */
export async function verifyEmailCode(
    secret: string,
    email: string,
    purpose: EmailVerificationPurpose,
    code: string,
    storedHash: string,
): Promise<boolean> {
    const actual = await hashEmailCode(secret, email, purpose, code);
    return timingSafeEqual(actual, storedHash.toLowerCase());
}

/**
 * 创建一条验证码记录。
 *
 * 发送冷却按“最近一次发送时间”判断，而不是按是否已消费判断：
 * 这样即使上一封邮件已成功使用，短时间内仍不能连续请求新验证码。
 */
export async function createEmailVerification(
    db: DB,
    email: string,
    purpose: EmailVerificationPurpose,
    secret: string,
): Promise<{ id: number; code: string; expiresIn: number }> {
    const latest = await db.query.emailVerifications.findFirst({
        where: and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, purpose)),
        orderBy: [desc(emailVerifications.createdAt)],
    });

    if (latest?.createdAt) {
        const elapsed = Date.now() - new Date(latest.createdAt).getTime();
        if (elapsed >= 0 && elapsed < EMAIL_CODE_RESEND_SECONDS * 1000) {
            throw new RateLimitError("Please wait before requesting another verification code");
        }
    }

    const code = generateEmailCode();
    const codeHash = await hashEmailCode(secret, email, purpose, code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_SECONDS * 1000);

    await db.insert(emailVerifications).values({
        email,
        purpose,
        codeHash,
        expiresAt,
        attempts: 0,
    });

    const inserted = await db.query.emailVerifications.findFirst({
        where: and(
            eq(emailVerifications.email, email),
            eq(emailVerifications.purpose, purpose),
            eq(emailVerifications.codeHash, codeHash),
        ),
        orderBy: [desc(emailVerifications.createdAt)],
    });

    if (!inserted) {
        throw new Error("Failed to persist email verification code");
    }

    return { id: inserted.id, code, expiresIn: EMAIL_CODE_TTL_SECONDS };
}

export type ConsumeEmailCodeResult =
    | { ok: true }
    | { ok: false; reason: "missing" | "expired" | "attempts" | "invalid" | "used" };

/**
 * 消费验证码。
 *
 * 校验成功后会同时把记录标记为已消费，避免同一验证码被并发请求重复使用。
 * 校验失败会累加 attempts；达到上限后不再允许继续尝试。
 */
export async function consumeEmailVerification(
    db: DB,
    email: string,
    purpose: EmailVerificationPurpose,
    code: string,
    secret: string,
): Promise<ConsumeEmailCodeResult> {
    const record = await db.query.emailVerifications.findFirst({
        where: and(
            eq(emailVerifications.email, email),
            eq(emailVerifications.purpose, purpose),
            isNull(emailVerifications.consumedAt),
        ),
        orderBy: [desc(emailVerifications.createdAt)],
    });

    if (!record) {
        return { ok: false, reason: "missing" };
    }

    if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        return { ok: false, reason: "attempts" };
    }

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
        return { ok: false, reason: "expired" };
    }

    const valid = await verifyEmailCode(secret, email, purpose, code, record.codeHash);
    if (!valid) {
        await db.update(emailVerifications)
            .set({ attempts: record.attempts + 1 })
            .where(eq(emailVerifications.id, record.id));
        return { ok: false, reason: "invalid" };
    }

    const consumed = await db.update(emailVerifications)
        .set({ consumedAt: new Date() })
        .where(and(eq(emailVerifications.id, record.id), isNull(emailVerifications.consumedAt)))
        .returning({ id: emailVerifications.id });

    if (consumed.length === 0) {
        return { ok: false, reason: "used" };
    }

    return { ok: true };
}

/** 判断邮件配置是否足以发送验证码：必须启用并配置 Cloud Mail 发件账号。 */
export async function isMailReady(serverConfig: ConfigReader): Promise<boolean> {
    const config = await resolveMailConfig(serverConfig);
    return Boolean(config.enabled && config.apiUrl && config.email && config.password);
}

/**
 * 发送验证码邮件。
 *
 * 复用后台已配置的 Cloud Mail 账号，但通过 mail.to 覆盖把收件人改成当前注册/换绑邮箱，
 * 不依赖后台“通知收件人”字段。
 */
export async function sendVerificationEmail(
    serverConfig: ConfigReader,
    to: string,
    code: string,
    purpose: EmailVerificationPurpose,
    siteName: string,
): Promise<SendMailResult> {
    const config = await resolveMailConfig(serverConfig, { "mail.to": to });

    if (!config.enabled) {
        return { success: false, error: "Mail service is disabled" };
    }

    const action = purpose === "register" ? "注册账号" : "更换邮箱";
    const minutes = Math.floor(EMAIL_CODE_TTL_SECONDS / 60);

    return await sendMail(config, {
        subject: `【${siteName || "Rin"}】${action}验证码`,
        html: [
            `<p>你正在${action}，验证码为：</p>`,
            `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${escapeHtml(code)}</p>`,
            `<p>验证码 ${minutes} 分钟内有效，仅可使用一次。</p>`,
            `<p>如果这不是你的操作，请忽略本邮件。</p>`,
        ].join(""),
        text: `你正在${action}，验证码：${code}。验证码 ${minutes} 分钟内有效，仅可使用一次。`,
    });
}
