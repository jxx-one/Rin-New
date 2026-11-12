import { asc, eq } from "drizzle-orm";
import type { DB } from "../../core/hono-types";
import { feedAttachments } from "../../db/schema";

/**
 * 单个附件大小上限：99 MB。
 * R2 单对象上限是 5 TiB，但附件目前经 Worker 中转上传，
 * Cloudflare Workers Free / Pro 的单次请求体上限是 100 MB，
 * 预留 1 MB 给 multipart 边界和表单字段，避免刚好 100 MB 的文件被 413。
 * Business 套餐可把请求体上限提高到 200 MB，届时可同步调整此值。
 */
export const MAX_FEED_ATTACHMENT_MB = 99;
export const MAX_FEED_ATTACHMENT_SIZE = MAX_FEED_ATTACHMENT_MB * 1024 * 1024;

/** 单篇文章附件数量上限，避免公开文章被大量附件拖慢详情请求。 */
export const MAX_FEED_ATTACHMENTS = 20;

/** 返回给前台的附件元数据，刻意不包含 storageKey 和真实存储地址。 */
export interface FeedAttachmentMeta {
    id: number;
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: unknown;
}

export function toFeedAttachmentMeta(row: any): FeedAttachmentMeta {
    return {
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        size: row.size,
        createdAt: row.createdAt,
    };
}

export async function listFeedAttachmentRows(db: DB, feedId: number) {
    return db.query.feedAttachments.findMany({
        where: eq(feedAttachments.feedId, feedId),
        orderBy: [asc(feedAttachments.createdAt), asc(feedAttachments.id)],
    });
}

export async function listFeedAttachmentMeta(db: DB, feedId: number) {
    const rows = await listFeedAttachmentRows(db, feedId);
    return rows.map(toFeedAttachmentMeta);
}

/**
 * 从上传文件名中去掉路径和控制字符，避免把客户端路径写入数据库或响应头。
 * 保留 Unicode 文件名，下载时通过 RFC 5987 编码输出。
 */
export function sanitizeAttachmentFileName(fileName: string | undefined) {
    const baseName = (fileName || "attachment")
        .split(/[\\/]/)
        .pop()
        ?.replace(/[\u0000-\u001f\u007f"\\]/g, "_")
        .trim();

    if (!baseName) {
        return "attachment";
    }

    // 文件名过长会让 Content-Disposition 头过大，截断时尽量保留扩展名。
    if (baseName.length <= 200) {
        return baseName;
    }

    const lastDot = baseName.lastIndexOf(".");
    if (lastDot > 0 && baseName.length - lastDot <= 16) {
        return `${baseName.slice(0, 200 - (baseName.length - lastDot))}${baseName.slice(lastDot)}`;
    }
    return baseName.slice(0, 200);
}

/** 只从文件名提取安全的短扩展名，用于拼接对象存储 key。 */
export function getAttachmentExtension(fileName: string) {
    const match = /(\.[a-zA-Z0-9]{1,12})$/.exec(fileName);
    return match ? match[1].toLowerCase() : "";
}

/** 构造 Content-Disposition，兼容中文文件名和旧浏览器。 */
export function buildAttachmentContentDisposition(fileName: string) {
    const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encoded = encodeURIComponent(fileName);
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
