// Cloudflare Turnstile 人机验证
//
// 开关、站点密钥、服务端密钥都存在后台设置里：
// - turnstile.enabled   -> client config（公开）
// - turnstile.site_key  -> client config（公开，前端渲染组件用）
// - turnstile.secret_key-> server config（敏感字段，接口只返回掩码）
//
// 三项任一缺失时视为未启用，登录/注册/重置接口直接放行，避免管理员只填一半时把站点锁死。

import { BadRequestError, ForbiddenError, ServiceUnavailableError } from "../errors";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type ConfigReader = {
    get(key: string): Promise<unknown>;
};

export interface TurnstileConfig {
    enabled: boolean;
    siteKey: string;
    secretKey: string;
}

const DISABLED: TurnstileConfig = { enabled: false, siteKey: "", secretKey: "" };

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    if (typeof value === "number") return value !== 0;
    return Boolean(value);
}

export async function resolveTurnstileConfig(
    clientConfig: ConfigReader | undefined | null,
    serverConfig: ConfigReader | undefined | null,
): Promise<TurnstileConfig> {
    if (!clientConfig || !serverConfig) {
        return DISABLED;
    }

    const [enabledValue, siteKeyValue, secretKeyValue] = await Promise.all([
        clientConfig.get("turnstile.enabled"),
        clientConfig.get("turnstile.site_key"),
        serverConfig.get("turnstile.secret_key"),
    ]);

    return {
        enabled: readBoolean(enabledValue),
        siteKey: readString(siteKeyValue),
        secretKey: readString(secretKeyValue),
    };
}

/** 开关打开且两把密钥都齐全时才真正生效。 */
export function isTurnstileActive(config: TurnstileConfig): boolean {
    return config.enabled && config.siteKey.length > 0 && config.secretKey.length > 0;
}

/**
 * 校验客户端提交的 Turnstile token。
 *
 * 未启用时什么都不做；启用后 token 缺失或校验失败都会抛错。
 * 网络故障返回 503 而不是 403，避免把服务不可用误报成验证失败。
 */
export async function assertTurnstileToken(
    config: TurnstileConfig,
    token: unknown,
    remoteIp?: string | null,
): Promise<void> {
    if (!isTurnstileActive(config)) {
        return;
    }

    const responseToken = readString(token);
    if (!responseToken) {
        throw new BadRequestError("Human verification is required");
    }

    const form = new FormData();
    form.append("secret", config.secretKey);
    form.append("response", responseToken);
    if (remoteIp) {
        form.append("remoteip", remoteIp);
    }

    let response: Response;
    try {
        response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new ServiceUnavailableError("Human verification service is unavailable");
    }

    if (!response.ok) {
        throw new ServiceUnavailableError("Human verification service is unavailable");
    }

    let result: { success?: boolean } | null = null;
    try {
        result = await response.json() as { success?: boolean };
    } catch {
        result = null;
    }

    if (!result?.success) {
        throw new ForbiddenError("Human verification failed");
    }
}
