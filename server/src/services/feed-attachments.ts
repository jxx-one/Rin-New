import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Variables } from "../core/hono-types";
import { userOnly } from "../core/route-boundaries";
import { profileAsync } from "../core/server-timing";
import { feedAttachments } from "../db/schema";
import {
    MAX_FEED_ATTACHMENTS,
    MAX_FEED_ATTACHMENT_SIZE,
    buildAttachmentContentDisposition,
    getAttachmentExtension,
    listFeedAttachmentMeta,
    sanitizeAttachmentFileName,
    toFeedAttachmentMeta,
} from "../features/feed/attachments";
import { findFeedById } from "../features/feed/repository";
import {
    hasFeedPassword,
} from "../utils/feed-password";
import { verifyFeedDownloadToken } from "../utils/feed-attachment-token";
import { deleteStorageObject, getStorageObject, putStorageObjectAtKey } from "../utils/storage";
import { clearFeedCache } from "./clear-feed-cache";

function parseFeedId(value: string): number | null {
    if (!/^[1-9]\d*$/.test(value)) {
        return null;
    }
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function isFileLike(value: unknown): value is File {
    return Boolean(value)
        && typeof value === "object"
        && typeof (value as File).arrayBuffer === "function"
        && typeof (value as File).size === "number";
}

/**
 * 文章附件服务。
 *
 * 路由挂在 /api/feed 下，和 FeedService 共用文章 ID。
 * - 上传/删除：必须登录，并且是文章作者或管理员。
 * - 下载：文章没有密码时公开；有密码时游客必须携带解锁后签发的短期 token，
 *   作者/管理员仍然免密。
 */
export function FeedAttachmentService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /feed/:id/attachments - 附件元数据列表
    // 有密码的文章对游客只返回数量和 locked 标记，不泄露文件名。
    app.get("/:id/attachments", async (c) => {
        const db = c.get("db");
        const admin = c.get("admin");
        const uid = c.get("uid");
        const env = c.get("env");
        const feedId = parseFeedId(c.req.param("id"));

        if (feedId === null) {
            return c.text("Not found", 404);
        }

        const feed = await profileAsync(c, "feed_attachment_list_feed", () => findFeedById(db, feedId));
        if (!feed) {
            return c.text("Not found", 404);
        }
        if (feed.draft && feed.uid !== uid && !admin) {
            return c.text("Permission denied", 403);
        }

        const attachments = await profileAsync(c, "feed_attachment_list_rows", () => listFeedAttachmentMeta(db, feedId));
        const ownerOrAdmin = feed.uid === uid || admin;

        if (hasFeedPassword(feed.passwordHash) && !ownerOrAdmin) {
            const token = c.req.query("token");
            if (!(await verifyFeedDownloadToken(env, feedId, token))) {
                return c.json({
                    locked: true,
                    passwordProtected: true,
                    attachmentCount: attachments.length,
                });
            }
        }

        return c.json({
            locked: false,
            passwordProtected: hasFeedPassword(feed.passwordHash),
            attachments,
        });
    });

    // POST /feed/:id/attachments - 上传附件
    app.post("/:id/attachments", userOnly(async (c, uid) => {
        const db = c.get("db");
        const env = c.get("env");
        const admin = c.get("admin");
        const feedId = parseFeedId(c.req.param("id"));

        if (feedId === null) {
            return c.text("Not found", 404);
        }

        const feed = await profileAsync(c, "feed_attachment_upload_feed", () => findFeedById(db, feedId));
        if (!feed) {
            return c.text("Not found", 404);
        }
        if (feed.uid !== uid && !admin) {
            return c.text("Permission denied", 403);
        }

        const body = await profileAsync(c, "feed_attachment_parse", () => c.req.parseBody());
        const file = body.file;

        if (!isFileLike(file)) {
            return c.text("Attachment file is required", 400);
        }
        if (file.size <= 0) {
            return c.text("Attachment file is empty", 400);
        }
        if (file.size > MAX_FEED_ATTACHMENT_SIZE) {
            return c.text(`Attachment is too large (max ${MAX_FEED_ATTACHMENT_SIZE / 1024 / 1024} MB)`, 413);
        }

        const existingCount = await profileAsync(c, "feed_attachment_count", async () => {
            const rows = await db.select({ value: count() }).from(feedAttachments).where(eq(feedAttachments.feedId, feedId));
            return rows[0]?.value ?? 0;
        });
        if (existingCount >= MAX_FEED_ATTACHMENTS) {
            return c.text(`Too many attachments (max ${MAX_FEED_ATTACHMENTS})`, 400);
        }

        const fileName = sanitizeAttachmentFileName(file.name);
        const extension = getAttachmentExtension(fileName);
        // 使用随机 UUID 作为对象键，前台永远不会拿到 storage_key。
        const storageKey = `private/attachments/${feedId}/${crypto.randomUUID()}${extension}`;
        const mimeType = file.type || "application/octet-stream";

        try {
            await profileAsync(c, "feed_attachment_put", () => putStorageObjectAtKey(
                env,
                storageKey,
                file,
                mimeType,
                new URL(c.req.url).origin,
            ));

            const [inserted] = await profileAsync(c, "feed_attachment_insert", () => db.insert(feedAttachments).values({
                feedId,
                storageKey,
                fileName,
                mimeType,
                size: file.size,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning());

            // 附件变化后清掉文章详情缓存，作者刷新写作页能立即看到新附件。
            await profileAsync(c, "feed_attachment_upload_cache", () => clearFeedCache(c.get("cache"), feedId, feed.alias, feed.alias));

            return c.json({ attachment: toFeedAttachmentMeta(inserted) }, 201);
        } catch (error) {
            console.error("Feed attachment upload failed:", error);
            // 元数据写入失败时尝试清理已上传的对象，避免留下孤儿文件。
            try {
                await deleteStorageObject(env, storageKey);
            } catch (cleanupError) {
                console.error("Feed attachment upload cleanup failed:", cleanupError);
            }
            const message = error instanceof Error ? error.message : "Attachment upload failed";
            return c.text(message, 500);
        }
    }, { message: "Unauthorized", status: 401 }));

    // DELETE /feed/:id/attachments/:attachmentId - 删除附件
    app.delete("/:id/attachments/:attachmentId", userOnly(async (c, uid) => {
        const db = c.get("db");
        const env = c.get("env");
        const admin = c.get("admin");
        const feedId = parseFeedId(c.req.param("id"));
        const attachmentId = parseFeedId(c.req.param("attachmentId"));

        if (feedId === null || attachmentId === null) {
            return c.text("Not found", 404);
        }

        const feed = await profileAsync(c, "feed_attachment_delete_feed", () => findFeedById(db, feedId));
        if (!feed) {
            return c.text("Not found", 404);
        }
        if (feed.uid !== uid && !admin) {
            return c.text("Permission denied", 403);
        }

        // 附件必须同时匹配文章 ID 和附件 ID，防止跨文章删除。
        const attachment = await profileAsync(c, "feed_attachment_delete_row", () => db.query.feedAttachments.findFirst({
            where: eq(feedAttachments.id, attachmentId),
        }));

        if (!attachment || attachment.feedId !== feedId) {
            return c.text("Not found", 404);
        }

        try {
            await profileAsync(c, "feed_attachment_delete_object", () => deleteStorageObject(env, attachment.storageKey));
        } catch (error) {
            // 对象存储删除失败时仍然删除元数据，避免它一直出现在文章里；残留对象由运维清理。
            console.error("Feed attachment storage delete failed:", error);
        }

        await profileAsync(c, "feed_attachment_delete_db", () => db.delete(feedAttachments).where(eq(feedAttachments.id, attachmentId)));
        await profileAsync(c, "feed_attachment_delete_cache", () => clearFeedCache(c.get("cache"), feedId, feed.alias, feed.alias));

        return c.json({ deleted: true });
    }, { message: "Unauthorized", status: 401 }));

    // GET /feed/:id/attachments/:attachmentId - 鉴权下载
    app.get("/:id/attachments/:attachmentId", async (c) => {
        const db = c.get("db");
        const env = c.get("env");
        const admin = c.get("admin");
        const uid = c.get("uid");
        const feedId = parseFeedId(c.req.param("id"));
        const attachmentId = parseFeedId(c.req.param("attachmentId"));

        if (feedId === null || attachmentId === null) {
            return c.text("Not found", 404);
        }

        const feed = await profileAsync(c, "feed_attachment_download_feed", () => findFeedById(db, feedId));
        if (!feed) {
            return c.text("Not found", 404);
        }
        if (feed.draft && feed.uid !== uid && !admin) {
            return c.text("Permission denied", 403);
        }

        const attachment = await profileAsync(c, "feed_attachment_download_row", () => db.query.feedAttachments.findFirst({
            where: eq(feedAttachments.id, attachmentId),
        }));
        if (!attachment || attachment.feedId !== feedId) {
            return c.text("Not found", 404);
        }

        const ownerOrAdmin = feed.uid === uid || admin;
        // 有密码时，游客必须携带解锁文章后得到的短期 token；作者/管理员永远免密。
        if (hasFeedPassword(feed.passwordHash) && !ownerOrAdmin) {
            const token = c.req.query("token");
            if (!(await verifyFeedDownloadToken(env, feedId, token))) {
                return c.text("Download token is invalid or expired", 401);
            }
        }

        const stored = await profileAsync(c, "feed_attachment_download_object", () => getStorageObject(env, attachment.storageKey));
        if (!stored) {
            return c.text("Not found", 404);
        }

        const headers = new Headers();
        headers.set("Content-Type", attachment.mimeType || "application/octet-stream");
        headers.set("Content-Disposition", buildAttachmentContentDisposition(attachment.fileName));
        headers.set("Content-Length", String(attachment.size));
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");

        return new Response(stored.body, {
            status: 200,
            headers,
        });
    });

    return app;
}
