/**
 * 密码哈希与校验工具。
 *
 * 旧版本用户密码使用无盐 SHA-256（64 位十六进制字符串）。为了兼容历史账号，
 * 登录校验仍接受这种旧格式；新注册和修改密码统一写入带随机盐的 PBKDF2 格式：
 *
 *   v1:<迭代次数>:<盐的十六进制>:<派生密钥的十六进制>
 *
 * 登录成功后如需标记“密码需要升级”，可调用 isLegacyPasswordHash 判断。
 */

const PASSWORD_HASH_PREFIX = "v1";
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
        throw new Error("Invalid hex string");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

/** 常量时间字符串比较，避免通过响应耗时推测密码或验证码。 */
export function timingSafeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);
    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    let difference = 0;
    for (let index = 0; index < leftBytes.length; index += 1) {
        difference |= leftBytes[index] ^ rightBytes[index];
    }
    return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(digest));
}

async function derivePasswordHash(
    password: string,
    salt: BufferSource,
    iterations: number,
): Promise<string> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt,
            iterations,
            hash: "SHA-256",
        },
        keyMaterial,
        DERIVED_KEY_BYTES * 8,
    );
    return bytesToHex(new Uint8Array(bits));
}

/** 生成新的 PBKDF2 密码哈希。 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await derivePasswordHash(password, salt as BufferSource, PBKDF2_ITERATIONS);
    return `${PASSWORD_HASH_PREFIX}:${PBKDF2_ITERATIONS}:${bytesToHex(salt)}:${hash}`;
}

/** 仅用于兼容旧账号或测试历史数据；新密码请使用 hashPassword。 */
export async function legacySha256PasswordHash(password: string): Promise<string> {
    return sha256Hex(password);
}

/** 判断存储值是否为旧版无盐 SHA-256。 */
export function isLegacyPasswordHash(stored: string | null | undefined): boolean {
    return Boolean(stored && /^[0-9a-f]{64}$/i.test(stored));
}

/**
 * 校验密码。
 *
 * 支持：
 * 1. 新格式 v1:<iterations>:<salt>:<hash>；
 * 2. 旧格式 64 位十六进制 SHA-256。
 *
 * 注意：旧格式仅用于兼容已有账号，新写入不应再使用。
 */
export async function verifyPassword(
    password: string,
    stored: string | null | undefined,
): Promise<boolean> {
    if (!stored) {
        return false;
    }

    if (isLegacyPasswordHash(stored)) {
        return timingSafeEqual(await legacySha256PasswordHash(password), stored.toLowerCase());
    }

    const parts = stored.split(":");
    if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) {
        return false;
    }

    const iterations = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 1_000_000) {
        return false;
    }

    try {
        const salt = hexToBytes(parts[2]);
        const actual = await derivePasswordHash(password, salt as BufferSource, iterations);
        return timingSafeEqual(actual, parts[3].toLowerCase());
    } catch {
        return false;
    }
}
