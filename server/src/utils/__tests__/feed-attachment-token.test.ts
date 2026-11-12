import { describe, expect, it } from "bun:test";
import {
    FEED_DOWNLOAD_TOKEN_TTL_SECONDS,
    createFeedDownloadToken,
    verifyFeedDownloadToken,
} from "../feed-attachment-token";

const env = { JWT_SECRET: "attachment-test-secret" } as Env;

describe("feed attachment download token", () => {
    it("issues a token bound to the feed and accepts it for the same feed", async () => {
        const result = await createFeedDownloadToken(env, 7);
        expect(result.token.startsWith("v1:7:")).toBe(true);
        expect(result.expiresAt).toBeString();
        expect(await verifyFeedDownloadToken(env, 7, result.token)).toBe(true);
    });

    it("rejects a token for another feed", async () => {
        const result = await createFeedDownloadToken(env, 7);
        expect(await verifyFeedDownloadToken(env, 8, result.token)).toBe(false);
    });

    it("rejects malformed and tampered tokens", async () => {
        expect(await verifyFeedDownloadToken(env, 7, undefined)).toBe(false);
        expect(await verifyFeedDownloadToken(env, 7, "not-a-token")).toBe(false);
        expect(await verifyFeedDownloadToken(env, 7, "v1:7:9999999999:bad")).toBe(false);

        const result = await createFeedDownloadToken(env, 7);
        const tampered = result.token.slice(0, -1) + (result.token.endsWith("0") ? "1" : "0");
        expect(await verifyFeedDownloadToken(env, 7, tampered)).toBe(false);
    });

    it("does not sign without a secret", async () => {
        await expect(createFeedDownloadToken({ JWT_SECRET: "" } as Env, 7)).rejects.toThrow();
        expect(await verifyFeedDownloadToken({ JWT_SECRET: "" } as Env, 7, "v1:7:9999999999:bad")).toBe(false);
    });

    it("keeps the advertised token lifetime at 30 minutes", () => {
        expect(FEED_DOWNLOAD_TOKEN_TTL_SECONDS).toBe(30 * 60);
    });
});
