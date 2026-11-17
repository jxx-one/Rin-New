import { afterEach, describe, expect, it } from "bun:test";
import {
    assertTurnstileToken,
    isTurnstileActive,
    resolveTurnstileConfig,
    type TurnstileConfig,
} from "../turnstile";

const originalFetch = globalThis.fetch;

function reader(values: Record<string, unknown>) {
    return {
        async get(key: string) {
            return values[key];
        },
    };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("resolveTurnstileConfig", () => {
    it("returns disabled when configs are missing", async () => {
        const config = await resolveTurnstileConfig(null, null);
        expect(config).toEqual({ enabled: false, siteKey: "", secretKey: "" });
        expect(isTurnstileActive(config)).toBe(false);
    });

    it("is active only when enabled and both keys exist", async () => {
        const clientConfig = reader({ "turnstile.enabled": true, "turnstile.site_key": "site-key" });
        const serverConfig = reader({ "turnstile.secret_key": "secret-key" });

        const config = await resolveTurnstileConfig(clientConfig, serverConfig);
        expect(config).toEqual({ enabled: true, siteKey: "site-key", secretKey: "secret-key" });
        expect(isTurnstileActive(config)).toBe(true);
    });

    it("stays inactive when the secret key is missing", async () => {
        const config = await resolveTurnstileConfig(
            reader({ "turnstile.enabled": "true", "turnstile.site_key": "site-key" }),
            reader({}),
        );
        expect(isTurnstileActive(config)).toBe(false);
    });
});

describe("assertTurnstileToken", () => {
    const active: TurnstileConfig = { enabled: true, siteKey: "site-key", secretKey: "secret-key" };

    it("skips verification when disabled", async () => {
        await expect(assertTurnstileToken({ enabled: false, siteKey: "", secretKey: "" }, undefined)).resolves.toBeUndefined();
    });

    it("rejects a missing token when active", async () => {
        await expect(assertTurnstileToken(active, "")).rejects.toMatchObject({
            statusCode: 400,
        });
    });

    it("posts the token to siteverify and accepts success", async () => {
        const requests: Array<{ url: string; body: FormData }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), body: init?.body as FormData });
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;

        await expect(assertTurnstileToken(active, "token-123", "1.2.3.4")).resolves.toBeUndefined();

        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
        expect(requests[0].body.get("secret")).toBe("secret-key");
        expect(requests[0].body.get("response")).toBe("token-123");
        expect(requests[0].body.get("remoteip")).toBe("1.2.3.4");
    });

    it("rejects when siteverify reports failure", async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
        })) as typeof fetch;

        await expect(assertTurnstileToken(active, "bad-token")).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it("surfaces network failures as 503", async () => {
        globalThis.fetch = (async () => {
            throw new Error("network down");
        }) as typeof fetch;

        await expect(assertTurnstileToken(active, "token-123")).rejects.toMatchObject({
            statusCode: 503,
        });
    });
});
