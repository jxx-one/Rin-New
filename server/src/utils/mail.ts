import { MAIL_CONFIG_PREFIX } from "@rin/config";

export type MailEvent = "comment" | "friend" | "feed";

export interface MailConfig {
  enabled: boolean;
  apiUrl: string;
  email: string;
  password: string;
  accountId: string;
  fromName: string;
  to: string;
  events: Record<MailEvent, boolean>;
}

export interface MailMessage {
  subject: string;
  html: string;
  text?: string;
}

export type MailConfigOverrides = Partial<{
  "mail.enabled": boolean | string;
  "mail.api_url": string;
  "mail.email": string;
  "mail.password": string;
  "mail.account_id": string;
  "mail.from_name": string;
  "mail.to": string;
}>;

export interface SendMailResult {
  success: boolean;
  error?: string;
  details?: string;
  status?: number;
  skipped?: boolean;
}

type ConfigReader = {
  get(key: string): Promise<unknown>;
};

const DEFAULT_CLOUD_MAIL_URL = "https://skymail.ink";

type MailFetch = (input: string, init?: RequestInit) => Promise<Response>;

const globalMailFetch: MailFetch = (input, init) => fetch(input, init);

let mailFetch: MailFetch = globalMailFetch;

/**
 * 配置「调用 Cloud Mail API」所用的 fetch。
 *
 * 同一个 Cloudflare zone 内，Worker 不能用全局 fetch 调用挂在 Route 上的另一个 Worker：
 * 边缘会把子请求 302 回原地址，跟随重定向后抛 "Too many redirects"。
 * 因此线上改用 Service Binding（env.CLOUD_MAIL）直连 Cloud Mail；
 * 本地 dev 或未配置绑定时回落到普通 fetch。
 *
 * 参数用 unknown 接收：Env 里没有 CLOUD_MAIL 字段，
 * 若声明成 { CLOUD_MAIL?: Fetcher } 会触发 TS 弱类型检测（TS2559），
 * 所以这里在函数内部做一次收窄。
 */
export function bindMailFetch(env: unknown) {
  const binding = (env as { CLOUD_MAIL?: Fetcher } | null | undefined)?.CLOUD_MAIL;
  mailFetch = binding
    ? (input, init) => binding.fetch(input, init)
    : globalMailFetch;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

/**
 * Cloud Mail 的接口都以站点根地址为基准，例如 https://mail.example.com。
 * 这里兼容用户误填的结尾斜杠或 /api 后缀，统一还原成站点根地址。
 */
export function normalizeCloudMailBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.toLowerCase().endsWith("/api")) {
    return trimmed.slice(0, -4).replace(/\/+$/, "");
  }
  return trimmed;
}

/**
 * 旧版邮件配置默认指向 Resend，升级后不应把它当成 Cloud Mail 站点地址。
 */
function normalizeCloudMailSiteUrl(value: string): string {
  const normalized = normalizeCloudMailBaseUrl(value);
  const lower = normalized.toLowerCase();
  if (!normalized || lower === "https://api.resend.com" || lower.startsWith("https://api.resend.com/")) {
    return DEFAULT_CLOUD_MAIL_URL;
  }
  return normalized;
}

export async function resolveMailConfig(
  serverConfig: ConfigReader,
  overrides: MailConfigOverrides = {},
): Promise<MailConfig> {
  const [
    storedEnabled,
    storedApiUrl,
    storedEmail,
    storedPassword,
    storedAccountId,
    storedFromName,
    storedTo,
    storedNotifyComment,
    storedNotifyFriend,
    storedNotifyFeed,
  ] = await Promise.all([
    serverConfig.get(`${MAIL_CONFIG_PREFIX}enabled`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}api_url`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}email`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}password`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}account_id`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}from_name`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}to`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}notify_comment`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}notify_friend`),
    serverConfig.get(`${MAIL_CONFIG_PREFIX}notify_feed`),
  ]);

  return {
    enabled: normalizeBoolean(overrides["mail.enabled"] ?? storedEnabled, false),
    apiUrl: normalizeCloudMailSiteUrl(
      normalizeString(overrides["mail.api_url"] ?? storedApiUrl, DEFAULT_CLOUD_MAIL_URL),
    ),
    email: normalizeString(overrides["mail.email"] ?? storedEmail, ""),
    password:
      normalizeOptionalString(overrides["mail.password"]) ??
      normalizeOptionalString(storedPassword) ??
      "",
    accountId: normalizeString(overrides["mail.account_id"] ?? storedAccountId, ""),
    fromName: normalizeString(overrides["mail.from_name"] ?? storedFromName, ""),
    to: normalizeString(overrides["mail.to"] ?? storedTo, ""),
    events: {
      comment: normalizeBoolean(storedNotifyComment, true),
      friend: normalizeBoolean(storedNotifyFriend, true),
      feed: normalizeBoolean(storedNotifyFeed, true),
    },
  };
}

function htmlToPlainText(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRecipients(value: string) {
  return value
    .split(/[,;]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

type CloudMailResponse = {
  code?: number;
  message?: string;
  data?: unknown;
};

async function readCloudMailResponse(response: Response): Promise<{ json: CloudMailResponse | null; text: string }> {
  const text = (await response.text()).slice(0, 500);
  try {
    return { json: JSON.parse(text) as CloudMailResponse, text };
  } catch {
    return { json: null, text };
  }
}

/**
 * 登录 Cloud Mail，返回身份令牌。文档要求 Authorization 直接放令牌，不加 Bearer 前缀。
 */
async function loginCloudMail(config: MailConfig) {
  const response = await mailFetch(`${normalizeCloudMailBaseUrl(config.apiUrl)}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });

  const { json, text } = await readCloudMailResponse(response);
  const token = (json?.data as { token?: string } | undefined)?.token;
  const code = json?.code;

  if (!response.ok || (typeof code === "number" && code !== 200) || !token) {
    return {
      token: "",
      error: json?.message || `Cloud Mail login failed with status ${response.status}`,
      details: text,
      status: response.status,
    };
  }

  return { token, error: "", details: "", status: response.status };
}

type CloudMailAccount = {
  accountId?: number;
  email?: string;
  name?: string;
};

async function resolveAccount(config: MailConfig, token: string) {
  const configured = Number.parseInt(config.accountId.trim(), 10);
  if (Number.isFinite(configured) && configured > 0) {
    return { accountId: configured, name: "", error: "" };
  }

  const response = await mailFetch(`${normalizeCloudMailBaseUrl(config.apiUrl)}/api/account/list?size=30`, {
    method: "GET",
    headers: { Authorization: token },
  });

  const { json, text } = await readCloudMailResponse(response);
  const accounts = Array.isArray(json?.data) ? (json?.data as CloudMailAccount[]) : [];

  if (!response.ok || !Array.isArray(json?.data)) {
    return {
      accountId: 0,
      name: "",
      error: json?.message || "Cloud Mail account list request failed",
      details: text,
    };
  }

  const matched = accounts.find(
    (account) => String(account.email ?? "").trim().toLowerCase() === config.email.toLowerCase(),
  );

  if (matched?.accountId) {
    return { accountId: matched.accountId, name: String(matched.name ?? ""), error: "" };
  }

  if (accounts.length === 1 && accounts[0]?.accountId) {
    return { accountId: accounts[0].accountId, name: String(accounts[0].name ?? ""), error: "" };
  }

  return {
    accountId: 0,
    name: "",
    error: "Cloud Mail account id could not be resolved, please set it manually",
  };
}

export function buildMailRequest(
  config: MailConfig,
  message: MailMessage,
  token: string,
  accountId: number,
  fromName = "",
) {
  const recipients = splitRecipients(config.to);
  const name = fromName || config.fromName || config.email.split("@")[0] || "";

  return {
    url: `${normalizeCloudMailBaseUrl(config.apiUrl)}/api/email/send`,
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId,
      name,
      receiveEmail: recipients,
      subject: message.subject,
      content: message.html,
      text: message.text || htmlToPlainText(message.html),
      sendType: "",
      attachments: [],
    }),
  };
}

export async function sendMail(config: MailConfig, message: MailMessage): Promise<SendMailResult> {
  if (!config.to) {
    return { success: false, error: "Mail recipient is required" };
  }
  if (!config.email) {
    return { success: false, error: "Cloud Mail login email is required" };
  }
  if (!config.password) {
    return { success: false, error: "Cloud Mail password is required" };
  }
  if (!config.apiUrl) {
    return { success: false, error: "Cloud Mail site URL is required" };
  }
  if (splitRecipients(config.to).length === 0) {
    return { success: false, error: "Mail recipient is required" };
  }

  let login: Awaited<ReturnType<typeof loginCloudMail>>;
  try {
    login = await loginCloudMail(config);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cloud Mail login failed",
    };
  }

  if (!login.token) {
    return {
      success: false,
      error: login.error,
      details: login.details,
      status: login.status,
    };
  }

  let accountId: number;
  let fromName = config.fromName;
  try {
    const account = await resolveAccount(config, login.token);
    if (!account.accountId) {
      return {
        success: false,
        error: account.error || "Cloud Mail account id could not be resolved",
        details: "details" in account ? String(account.details ?? "") : undefined,
        status: 400,
      };
    }
    accountId = account.accountId;
    if (!fromName) {
      fromName = account.name;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cloud Mail account resolution failed",
    };
  }

  const request = buildMailRequest(config, message, login.token, accountId, fromName);

  try {
    const response = await mailFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const { json, text } = await readCloudMailResponse(response);
    if (!response.ok || (json && typeof json.code === "number" && json.code !== 200)) {
      return {
        success: false,
        error: json?.message || `Cloud Mail send failed with status ${response.status}`,
        details: text,
        status: response.status,
      };
    }

    return { success: true, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cloud Mail send failed",
    };
  }
}

export async function sendEventMail(
  serverConfig: ConfigReader,
  event: MailEvent,
  message: MailMessage,
): Promise<SendMailResult> {
  const config = await resolveMailConfig(serverConfig);

  if (!config.enabled || !config.events[event] || !config.to) {
    return { success: false, skipped: true };
  }

  return await sendMail(config, message);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
