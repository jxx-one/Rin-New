// 文章访问密码工具。
//
// 设计要点：
// 1. 数据库只保存“盐 + SHA-256 摘要”，不保存明文密码，避免数据库导出时直接泄露密码。
// 2. 每条文章使用独立随机盐，降低相同密码在不同文章之间被直接比对的风险。
// 3. 摘要格式固定为 `v1:<salt>:<hash>`，以后需要升级算法时可以按前缀区分旧数据。
const HASH_PREFIX = "v1";
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return bytesToHex(bytes);
}

async function digestPassword(password: string, salt: string) {
  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * 生成文章密码的存储值。
 * 返回值只包含盐和摘要，可以直接写入 feeds.password_hash。
 */
export async function createFeedPasswordHash(password: string) {
  const salt = createSalt();
  const hash = await digestPassword(password, salt);
  return `${HASH_PREFIX}:${salt}:${hash}`;
}

/**
 * 校验文章访问密码。
 * 存储值格式不正确时直接返回 false，不抛出异常，避免异常信息暴露内部格式。
 */
export async function verifyFeedPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) {
    return true;
  }

  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) {
    return false;
  }

  const [, salt, expectedHash] = parts;
  if (!salt || !expectedHash) {
    return false;
  }

  const actualHash = await digestPassword(password, salt);

  // 固定长度逐字符比较，避免普通字符串比较在理论上产生的提前返回差异。
  if (actualHash.length !== expectedHash.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }

  return difference === 0;
}

/**
 * 判断文章是否启用了密码访问。
 * 空字符串和 null 都视为未启用。
 */
export function hasFeedPassword(passwordHash: string | null | undefined) {
  return Boolean(passwordHash);
}
