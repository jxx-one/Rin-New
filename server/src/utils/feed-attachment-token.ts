/**
 * 文章附件下载凭证。
 *
 * 游客在输入文章密码后，服务端会签发一个短期 HMAC 凭证。凭证只绑定文章 ID
 * 和过期时间，不绑定具体附件，因此同一篇文章下的附件可以共用同一个凭证。
 * 作者/管理员下载自己的附件时不需要凭证，由服务端直接按文章归属放行。
 */

/** 下载凭证有效期：30 分钟。 */
export const FEED_DOWNLOAD_TOKEN_TTL_SECONDS = 30 * 60;

export interface FeedDownloadTokenResult {
    token: string;
    expiresAt: string;
}

function toHex(buffer: ArrayBuffer) {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function signPayload(secret: string, payload: string) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    return toHex(signature);
}

/** 固定长度逐字符比较，避免普通字符串比较带来的时序差异。 */
function safeEqual(left: string, right: string) {
    if (left.length !== right.length) {
        return false;
    }
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return mismatch === 0;
}

/**
 * 为文章签发短期下载凭证。
 * 服务端必须配置 JWT_SECRET，否则文章密码解锁流程会直接报错而不是签发弱凭证。
 */
export async function createFeedDownloadToken(
    env: Pick<Env, "JWT_SECRET">,
    feedId: number,
): Promise<FeedDownloadTokenResult> {
    if (!env.JWT_SECRET) {
        throw new Error("JWT_SECRET is required to sign feed download tokens");
    }

    const expires = Math.floor(Date.now() / 1000) + FEED_DOWNLOAD_TOKEN_TTL_SECONDS;
    const payload = `v1:${feedId}:${expires}`;
    const signature = await signPayload(env.JWT_SECRET, payload);

    return {
        token: `${payload}:${signature}`,
        expiresAt: new Date(expires * 1000).toISOString(),
    };
}

/**
 * 校验下载凭证是否对指定文章有效。
 * 返回 false 覆盖格式错误、文章不匹配、过期和签名错误，调用方统一按未授权处理。
 */
export async function verifyFeedDownloadToken(
    env: Pick<Env, "JWT_SECRET">,
    feedId: number,
    token: string | undefined,
): Promise<boolean> {
    if (!token || !env.JWT_SECRET) {
        return false;
    }

    const parts = token.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
        return false;
    }

    const tokenFeedId = Number.parseInt(parts[1] || "", 10);
    const expires = Number.parseInt(parts[2] || "", 10);
    const signature = parts[3] || "";

    if (!Number.isInteger(tokenFeedId) || tokenFeedId !== feedId || !Number.isInteger(expires)) {
        return false;
    }
    if (expires <= Math.floor(Date.now() / 1000)) {
        return false;
    }

    const expected = await signPayload(env.JWT_SECRET, `v1:${tokenFeedId}:${expires}`);
    return safeEqual(expected, signature);
}
