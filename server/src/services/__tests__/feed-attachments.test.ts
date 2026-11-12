import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import type { Database } from "bun:sqlite";
import { setupTestApp, createTestUser, cleanupTestDB } from "../../../tests/fixtures";
import { FeedAttachmentService } from "../feed-attachments";
import { createFeedDownloadToken } from "../../utils/feed-attachment-token";
import { createFeedPasswordHash } from "../../utils/feed-password";

/** 轻量 R2 mock，只覆盖附件上传/下载/删除真正用到的方法。 */
function createFakeR2Bucket() {
    const objects = new Map<string, { body: Uint8Array; contentType?: string }>();

    return {
        objects,
        async put(key: string, body: any, options?: any) {
            const bytes = body instanceof Blob
                ? new Uint8Array(await body.arrayBuffer())
                : typeof body === "string"
                    ? new TextEncoder().encode(body)
                    : body instanceof ArrayBuffer
                        ? new Uint8Array(body)
                        : new Uint8Array(body);
            objects.set(key, {
                body: bytes,
                contentType: options?.httpMetadata?.contentType,
            });
            return {};
        },
        async get(key: string) {
            const object = objects.get(key);
            if (!object) {
                return null;
            }
            return {
                body: object.body,
                size: object.body.byteLength,
                httpEtag: "test-etag",
                uploaded: new Date(),
                writeHttpMetadata(headers: Headers) {
                    if (object.contentType) {
                        headers.set("Content-Type", object.contentType);
                    }
                },
            };
        },
        async head(key: string) {
            return this.get(key);
        },
        async delete(key: string) {
            objects.delete(key);
        },
    };
}

describe("FeedAttachmentService", () => {
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let fakeR2: ReturnType<typeof createFakeR2Bucket>;
    let attachmentId: number;

    beforeEach(async () => {
        fakeR2 = createFakeR2Bucket();
        const ctx = await setupTestApp(() => {
            const service = new Hono<{ Bindings: Env; Variables: Variables }>();
            service.route("/feed", FeedAttachmentService());
            return service;
        }, { R2_BUCKET: fakeR2 as unknown as R2Bucket });

        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;

        createTestUser(sqlite);
        // 用户 2 是普通用户，用于验证“非作者不能上传/删除”。
        sqlite.exec(`
            INSERT INTO users (id, username, avatar, openid, permission)
            VALUES (2, 'visitor', NULL, 'gh_visitor', 0)
        `);

        const passwordHash = await createFeedPasswordHash("article-secret");
        sqlite.prepare(`
            INSERT INTO feeds (id, title, content, summary, listed, draft, uid, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
        `).run(1, "Protected article", "Secret body", "Secret summary", 1, 0, 1, passwordHash);
        // 第二篇文章用于验证附件不能跨文章访问。
        sqlite.prepare(`
            INSERT INTO feeds (id, title, content, summary, listed, draft, uid, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
        `).run(2, "Other article", "Other body", "Other summary", 1, 0, 1, null);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function upload(userId: number, feedId = 1, fileName = "report.txt", content = "hello attachment") {
        const form = new FormData();
        form.append("file", new File([content], fileName, { type: "text/plain" }));
        return app.request(`/feed/${feedId}/attachments`, {
            method: "POST",
            headers: { Authorization: `Bearer mock_token_${userId}` },
            body: form,
        }, env);
    }

    it("lets the author upload and stores metadata without exposing the storage key", async () => {
        const response = await upload(1);
        expect(response.status).toBe(201);
        const data = await response.json() as any;
        attachmentId = data.attachment.id;
        expect(data.attachment.fileName).toBe("report.txt");
        expect(data.attachment.size).toBeGreaterThan(0);
        expect(data.attachment.storageKey).toBeUndefined();
        expect(data.attachment.url).toBeUndefined();
    });

    it("rejects uploads from non-owners", async () => {
        const response = await upload(2);
        expect(response.status).toBe(403);
        expect(fakeR2.objects.size).toBe(0);
    });

    it("hides file names from locked visitors and returns them after unlocking", async () => {
        await upload(1);
        attachmentId = (await (await upload(1, 1, "second.txt")).json() as any).attachment.id;

        const locked = await app.request("/feed/1/attachments", {}, env);
        expect(locked.status).toBe(200);
        const lockedData = await locked.json() as any;
        expect(lockedData.locked).toBe(true);
        expect(lockedData.attachmentCount).toBe(2);
        expect(lockedData.attachments).toBeUndefined();

        const owner = await app.request("/feed/1/attachments", {
            headers: { Authorization: "Bearer mock_token_1" },
        }, env);
        const ownerData = await owner.json() as any;
        expect(ownerData.locked).toBe(false);
        expect(ownerData.attachments).toHaveLength(2);
        expect(ownerData.attachments[0].fileName).toBe("report.txt");
    });

    it("requires a valid feed token for visitor downloads and allows author/admin downloads", async () => {
        await upload(1);
        attachmentId = (await (await upload(1)).json() as any).attachment.id;

        const noToken = await app.request(`/feed/1/attachments/${attachmentId}`, {}, env);
        expect(noToken.status).toBe(401);

        const wrongToken = await app.request(`/feed/1/attachments/${attachmentId}?token=wrong`, {}, env);
        expect(wrongToken.status).toBe(401);

        const token = await createFeedDownloadToken(env, 1);
        const visitorDownload = await app.request(
            `/feed/1/attachments/${attachmentId}?token=${encodeURIComponent(token.token)}`,
            {},
            env,
        );
        expect(visitorDownload.status).toBe(200);
        expect(await visitorDownload.text()).toBe("hello attachment");
        expect(visitorDownload.headers.get("Content-Disposition")).toContain("report.txt");
        expect(visitorDownload.headers.get("Cache-Control")).toContain("no-store");

        const authorDownload = await app.request(`/feed/1/attachments/${attachmentId}`, {
            headers: { Authorization: "Bearer mock_token_1" },
        }, env);
        expect(authorDownload.status).toBe(200);
    });

    it("rejects cross-feed attachment access and non-owner deletion", async () => {
        const feedOneAttachment = (await (await upload(1, 1)).json() as any).attachment;
        const feedTwoAttachment = (await (await upload(1, 2)).json() as any).attachment;

        const crossFeed = await app.request(`/feed/1/attachments/${feedTwoAttachment.id}`, {
            headers: { Authorization: "Bearer mock_token_1" },
        }, env);
        expect(crossFeed.status).toBe(404);

        const forbiddenDelete = await app.request(`/feed/1/attachments/${feedOneAttachment.id}`, {
            method: "DELETE",
            headers: { Authorization: "Bearer mock_token_2" },
        }, env);
        expect(forbiddenDelete.status).toBe(403);
        expect(fakeR2.objects.size).toBe(2);

        const ownerDelete = await app.request(`/feed/1/attachments/${feedOneAttachment.id}`, {
            method: "DELETE",
            headers: { Authorization: "Bearer mock_token_1" },
        }, env);
        expect(ownerDelete.status).toBe(200);
        expect(fakeR2.objects.size).toBe(1);
        expect(sqlite.query("SELECT COUNT(*) AS count FROM feed_attachments WHERE feed_id = 1").get()).toEqual({ count: 0 });
    });
});
