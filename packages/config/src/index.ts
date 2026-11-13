import type { AIConfig } from "@rin/api";

export const WEBHOOK_URL_KEY = "WEBHOOK_URL";

export const CLIENT_CONFIG_DEFAULTS = new Map(
  Object.entries({
    "cache.enabled": false,
    "counter.enabled": true,
    "friend_apply_enable": true,
    "header.behavior": "fixed",
    "header.layout": "classic",
    "feed.layout": "list",
    "feed.card_variant": "default",
    "theme.color": "#fc466b",
    "comment.enabled": true,
    "login.enabled": true,
    // 邮箱注册默认关闭；管理员在设置页开启，且必须先配置好 Cloud Mail 发件账号。
    "register.enabled": false,
    "site.name": "Rin",
    "site.description": "A lightweight personal blogging system",
    "site.avatar": "",
    "site.page_size": 5,
  }),
);

export const SERVER_CONFIG_DEFAULTS = new Map(
  Object.entries({
    friend_apply_auto_accept: false,
    friend_crontab: true,
    friend_ua: "Rin-Check/0.1.0",
    "webhook.method": "POST",
    "webhook.content_type": "application/json",
    "webhook.headers": "{}",
    "webhook.body_template": "{\"content\":\"{{message}}\"}",
    "mail.enabled": false,
    "mail.api_url": "填写你的 Cloud Mail 邮箱地址，格式：https://example.com",
    "mail.email": "",
    "mail.account_id": "",
    "mail.from_name": "",
    "mail.to": "",
    "mail.notify_comment": true,
    "mail.notify_friend": true,
    "mail.notify_feed": true,
  }),
);

export const CLIENT_CONFIG_ENV_DEFAULTS: Record<string, string> = {
  "site.name": "NAME",
  "site.description": "DESCRIPTION",
  "site.avatar": "AVATAR",
  "site.page_size": "PAGE_SIZE",
};

export const AI_CONFIG_PREFIX = "ai_summary.";

export const MAIL_CONFIG_PREFIX = "mail.";

export const AI_CONFIG_KEYS = [
  `${AI_CONFIG_PREFIX}enabled`,
  `${AI_CONFIG_PREFIX}provider`,
  `${AI_CONFIG_PREFIX}model`,
  `${AI_CONFIG_PREFIX}api_key`,
  `${AI_CONFIG_PREFIX}api_url`,
] as const;

export const SENSITIVE_SERVER_CONFIG_FIELDS = [
  `${AI_CONFIG_PREFIX}api_key`,
  `${MAIL_CONFIG_PREFIX}password`,
  // 旧版邮件通道的密钥已不再使用，但保留掩码避免历史配置明文暴露。
  `${MAIL_CONFIG_PREFIX}api_key`,
] as const;

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  provider: "openai",
  model: "gpt-4o-mini",
  api_key: "",
  api_url: "https://api.openai.com/v1",
};

export class ConfigWrapper {
  config: Record<string, unknown>;
  defaultConfig: Map<string, unknown>;

  constructor(config: Record<string, unknown>, defaultConfig: Map<string, unknown>) {
    this.config = config;
    this.defaultConfig = defaultConfig;
  }

  get<T>(key: string) {
    const value = this.config[key];
    if (value !== undefined && value !== "") {
      return value as T;
    }
    if (this.defaultConfig.has(key)) {
      return this.defaultConfig.get(key) as T;
    }
    return undefined;
  }

  default<T>(key: string) {
    return this.defaultConfig.get(key) as T;
  }

  getBoolean(key: string) {
    const value = this.get<unknown>(key);

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();

      if (normalizedValue === "true") {
        return true;
      }

      if (normalizedValue === "false") {
        return false;
      }
    }

    if (typeof value === "number") {
      return value !== 0;
    }

    return Boolean(value);
  }
}
