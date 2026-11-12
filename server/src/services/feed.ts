import {
    feedCreateSchema,
    feedSetSortSchema,
    feedSetTopSchema,
    feedUnlockSchema,
    feedUpdateSchema,
} from "@rin/api";
import type { CreateFeedRequest, UpdateFeedRequest } from "@rin/api";
import { and, asc, count, desc, eq, gt, lt } from "drizzle-orm";
import { Hono } from "hono";
import type { Variables } from "../core/hono-types";
import { adminOnly, userOnly, withJsonBody } from "../core/route-boundaries";
import { profileAsync } from "../core/server-timing";
import { feeds, visits, visitStats } from "../db/schema";
import {
    deleteFeedById,
    findDuplicateFeed,
    findFeedById,
    insertFeed,
    searchFeedPage,
    updateFeedById,
} from "../features/feed/repository";
import { HyperLogLog } from "../utils/hyperloglog";
import { extractImageWithMetadata } from "../utils/image";
import { createFeedDownloadToken } from "../utils/feed-attachment-token";
import { createFeedPasswordHash, hasFeedPassword, verifyFeedPassword } from "../utils/feed-password";
import { deleteStorageObject } from "../utils/storage";
import { listFeedAttachmentMeta, listFeedAttachmentRows } from "../features/feed/attachments";
import { stripMarkdown } from "../utils/markdown";
import { escapeHtml, sendEventMail } from "../utils/mail";
import { syncFeedAISummaryQueueState } from "./feed-ai-summary";
import { bindTagToPost } from "./tag";
import { clearFeedCache, clearFeedCollectionCaches } from "./clear-feed-cache";
export { clearFeedCache } from "./clear-feed-cache";

// Lazy-loaded modules for WordPress import
let XMLParser: any;
let html2md: any;

function parseFeedId(value: string): number | null {
    if (!/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum?: number) {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return maximum ? Math.min(parsed, maximum) : parsed;
}

async function initWPModules() {
    if (!XMLParser) {
        const fxp = await import("fast-xml-parser");
        XMLParser = fxp.XMLParser;
    }
    if (!html2md) {
        const h2m = await import("html-to-md");
        html2md = h2m.default;
    }
}

export function FeedService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /feed - List feeds
    app.get('/', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const page = c.req.query('page');
        const limit = c.req.query('limit');
        const type = c.req.query('type');

        if ((type === 'draft' || type === 'unlisted') && !admin) {
            return c.text('Permission denied', 403);
        }

        const page_num = parsePositiveInteger(page, 1) - 1;
        const limit_num = parsePositiveInteger(limit, 20, 50);
        const cacheKey = `feeds_${type}_${page_num}_${limit_num}`;
        const cached = await profileAsync(c, 'feed_list_cache_get', () => cache.get(cacheKey));

        if (cached) {
            return c.json(cached);
        }

        const where = type === 'draft'
            ? eq(feeds.draft, 1)
            : type === 'unlisted'
                ? and(eq(feeds.draft, 0), eq(feeds.listed, 0))
                : and(eq(feeds.draft, 0), eq(feeds.listed, 1));

        const size = await profileAsync(c, 'feed_list_count', () => db.select({ count: count() }).from(feeds).where(where));

        if (size[0].count === 0) {
            return c.json({ size: 0, data: [], hasNext: false });
        }

        const feed_list = (await profileAsync(c, 'feed_list_db', () => db.query.feeds.findMany({
            where: where,
            columns: admin ? undefined : { draft: false, listed: false },
            with: {
                hashtags: {
                    columns: {},
                    with: {
                        hashtag: { columns: { id: true, name: true } }
                    }
                },
                user: { columns: { id: true, username: true, avatar: true } }
            },
            orderBy: [desc(feeds.top), desc(feeds.sortOrder), desc(feeds.createdAt), desc(feeds.updatedAt)],
            offset: page_num * limit_num,
            limit: limit_num + 1,
        }))).map(({ content, hashtags, summary, passwordHash, ...other }: any) => {
            const passwordProtected = hasFeedPassword(passwordHash);
            const locked = passwordProtected && !admin;
            const avatar = locked ? null : extractImageWithMetadata(content);
            const plainText = stripMarkdown(content);
            return {
                summary: locked ? "" : summary.length > 0 ? summary : plainText.length > 100 ? plainText.slice(0, 100) : plainText,
                hashtags: hashtags.map(({ hashtag }: any) => hashtag),
                avatar,
                passwordProtected,
                ...other
            };
        });

        let hasNext = false;
        if (feed_list.length === limit_num + 1) {
            feed_list.pop();
            hasNext = true;
        }

        const data = { size: size[0].count, data: feed_list, hasNext };

        if (type === undefined || type === 'normal' || type === '') {
            await profileAsync(c, 'feed_list_cache_set', () => cache.set(cacheKey, data));
        }

        return c.json(data);
    });

    // GET /feed/timeline
    app.get('/timeline', async (c) => {
        const db = c.get('db');
        const where = and(eq(feeds.draft, 0), eq(feeds.listed, 1));

        return c.json(await profileAsync(c, 'feed_timeline_db', () => db.query.feeds.findMany({
            where: where,
            columns: { id: true, title: true, createdAt: true },
            orderBy: [desc(feeds.sortOrder), desc(feeds.createdAt), desc(feeds.updatedAt)],
        })));
    });

    // POST /feed - Create feed
    app.post('/', adminOnly(withJsonBody<CreateFeedRequest>(feedCreateSchema, async (c, body) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const serverConfig = c.get('serverConfig');
        const env = c.get('env');
        const uid = c.get('uid');
        const { title, alias, listed, content, summary, draft, tags, createdAt, password } = body;

        const exist = await profileAsync(c, 'feed_create_existing', () => findDuplicateFeed(db, title, content));

        if (exist) {
            return c.text('Content already exists', 400);
        }

        const date = createdAt ? new Date(createdAt) : new Date();
        const passwordValue = typeof password === 'string' ? password.trim() : "";
        // 只有填写了非空密码才生成哈希；空字符串视为普通文章。
        const passwordHash = passwordValue
            ? await profileAsync(c, 'feed_create_password_hash', () => createFeedPasswordHash(passwordValue))
            : null;

        if (!uid) {
            return c.text('User ID is required', 400);
        }

        const result = await profileAsync(c, 'feed_create_insert', () => insertFeed(db, {
            title,
            content,
            summary,
            ai_summary: "",
            ai_summary_status: "idle",
            ai_summary_error: "",
            uid,
            alias,
            listed: listed ? 1 : 0,
            draft: draft ? 1 : 0,
            passwordHash,
            createdAt: date,
            updatedAt: date
        }));

        if (!result) {
            return c.text('Failed to insert', 500);
        }

        await profileAsync(c, 'feed_create_tags', () => bindTagToPost(db, result.insertedId, tags));
        await profileAsync(c, 'feed_create_ai_queue', () => syncFeedAISummaryQueueState(db, serverConfig, env, result.insertedId, {
            draft: Boolean(draft),
            updatedAt: date,
            resetSummary: true,
        }));
        await profileAsync(c, 'feed_create_cache_invalidate', () => clearFeedCollectionCaches(cache));

        if (!draft) {
            const frontendUrl = env.FRONTEND_URL || new URL(c.req.url).origin;
            try {
                await profileAsync(c, 'feed_create_mail', () => sendEventMail(serverConfig, "feed", {
                    subject: `新文章：${title}`,
                    html: `<p>发布了新文章 <strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(summary || "")}</p><p><a href="${escapeHtml(`${frontendUrl}/feed/${alias || result.insertedId}`)}">阅读全文</a></p>`,
                }));
            } catch (error) {
                console.error("Failed to send feed mail", error);
            }
        }

        return c.json(result);
    }, {
        errorMessage: (issues) => {
            if (issues.some((issue) => issue.path === 'title' && /required|empty/.test(issue.message))) {
                return 'Title is required';
            }
            if (issues.some((issue) => issue.path === 'content' && /required|empty/.test(issue.message))) {
                return 'Content is required';
            }
            return issues[0]?.message ?? 'Invalid request body';
        },
    }), { message: 'Permission denied', status: 403 }));

    // GET /feed/export - Export all feeds as a JSON backup
    app.get('/export', adminOnly(async (c) => {
        const db = c.get('db');
        const list = await profileAsync(c, 'feed_export_db', () => db.query.feeds.findMany({
            with: {
                hashtags: {
                    columns: {},
                    with: { hashtag: { columns: { name: true } } },
                },
            },
            orderBy: [asc(feeds.createdAt), asc(feeds.id)],
        }));

        const exportedAt = new Date().toISOString();
        const payload = {
            version: 1,
            generator: "rin",
            exportedAt,
            feeds: list.map((feed: any) => ({
                title: feed.title,
                alias: feed.alias,
                content: feed.content,
                summary: feed.summary,
                listed: feed.listed,
                draft: feed.draft,
                top: feed.top,
                sortOrder: feed.sortOrder,
                // 导出只包含哈希，不包含明文密码；管理员备份恢复后密码保护仍然有效。
                passwordHash: feed.passwordHash ?? null,
                createdAt: feed.createdAt,
                updatedAt: feed.updatedAt,
                tags: feed.hashtags.map((item: any) => item.hashtag.name),
            })),
        };

        c.header('Content-Disposition', `attachment; filename="rin-feeds-${exportedAt.slice(0, 10)}.json"`);
        return c.json(payload);
    }, { message: 'Permission denied', status: 403 }));

    // POST /feed/import - Import feeds from a Rin JSON backup
    app.post('/import', adminOnly(async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const uid = c.get('uid') || 1;
        const contentType = c.req.header('content-type') || '';
        let payload: any;

        if (contentType.includes('application/json')) {
            payload = await profileAsync(c, 'feed_import_parse', () => c.req.json());
        } else {
            const body = await profileAsync(c, 'feed_import_parse_form', () => c.req.parseBody());
            const file = body.data as File | undefined;
            if (!file) {
                return c.text('Data is required', 400);
            }
            try {
                payload = JSON.parse(await file.text());
            } catch {
                return c.text('Invalid JSON file', 400);
            }
        }

        const items = Array.isArray(payload) ? payload : payload?.feeds;
        if (!Array.isArray(items)) {
            return c.text('Invalid backup format', 400);
        }
        if (items.length > 5000) {
            return c.text('Too many feeds in one import (max 5000)', 413);
        }

        let imported = 0;
        const skippedList: { title: string; reason: string }[] = [];

        for (const raw of items) {
            const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
            const content = typeof raw?.content === 'string' ? raw.content : '';
            const alias = typeof raw?.alias === 'string' && raw.alias.trim() ? raw.alias.trim() : null;

            if (!content.trim()) {
                skippedList.push({ title: title || '(untitled)', reason: 'invalid data' });
                continue;
            }

            if (alias) {
                const byAlias = await profileAsync(c, 'feed_import_alias_lookup', () =>
                    db.query.feeds.findFirst({ where: eq(feeds.alias, alias) }));
                if (byAlias) {
                    skippedList.push({ title: title || alias, reason: 'alias exists' });
                    continue;
                }
            }

            const byContent = await profileAsync(c, 'feed_import_content_lookup', () =>
                db.query.feeds.findFirst({ where: eq(feeds.content, content) }));
            if (byContent) {
                skippedList.push({ title: title || '(untitled)', reason: 'content exists' });
                continue;
            }

            const createdDate = new Date(raw?.createdAt);
            const createdAt = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
            const updatedDate = new Date(raw?.updatedAt);
            const updatedAt = Number.isNaN(updatedDate.getTime()) ? createdAt : updatedDate;
            const sortOrderValue = Number(raw?.sortOrder);
            const sortOrder = Number.isFinite(sortOrderValue) ? Math.trunc(sortOrderValue) : 0;

            // 只接受本系统生成的密码哈希格式，避免导入任意字符串导致文章永久无法解锁。
            let passwordHash: string | null = null;
            if (typeof raw?.passwordHash === 'string' && raw.passwordHash.trim()) {
                const value = raw.passwordHash.trim();
                if (!/^v1:[0-9a-f]{32}:[0-9a-f]{64}$/.test(value)) {
                    skippedList.push({ title: title || '(untitled)', reason: 'invalid password hash' });
                    continue;
                }
                passwordHash = value;
            }

            const inserted = await profileAsync(c, 'feed_import_insert', () => insertFeed(db, {
                title,
                content,
                summary: typeof raw?.summary === 'string' ? raw.summary : '',
                uid,
                alias,
                listed: raw?.listed === 0 || raw?.listed === false ? 0 : 1,
                draft: raw?.draft ? 1 : 0,
                top: raw?.top ? 1 : 0,
                sortOrder,
                passwordHash,
                createdAt,
                updatedAt,
            }));

            if (!inserted) {
                skippedList.push({ title, reason: 'insert failed' });
                continue;
            }

            const tags = Array.isArray(raw?.tags)
                ? raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
                : [];
            if (tags.length > 0) {
                await profileAsync(c, 'feed_import_tags', () => bindTagToPost(db, inserted.insertedId, tags));
            }
            imported++;
        }

        await profileAsync(c, 'feed_import_cache_invalidate', () => clearFeedCollectionCaches(cache));
        return c.json({ imported, skipped: skippedList.length, total: items.length, skippedList });
    }, { message: 'Permission denied', status: 403 }));

    // GET /feed/:id
    app.get('/:id', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const clientConfig = c.get('clientConfig');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');
        const id_num = parseFeedId(id);
        const cacheKey = id_num === null ? `feed_alias_${id}` : `feed_id_${id_num}`;
        const where = id_num === null ? eq(feeds.alias, id) : eq(feeds.id, id_num);

        const feed = await profileAsync(c, 'feed_detail_cache_db', () => cache.getOrSet(cacheKey, () => db.query.feeds.findFirst({
            where,
            with: {
                hashtags: {
                    columns: {},
                    with: {
                        hashtag: { columns: { id: true, name: true } }
                    }
                },
                user: { columns: { id: true, username: true, avatar: true } }
            }
        })));

        if (!feed) {
            return c.text('Not found', 404);
        }

        if (feed.draft && feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        const { hashtags, passwordHash, ...other } = feed;
        const hashtags_flatten = hashtags.map((f: any) => f.hashtag);
        const passwordProtected = hasFeedPassword(passwordHash);
        // 作者和管理员可以绕过密码查看正文；其他访问者只返回标题等元信息。
        const locked = passwordProtected && feed.uid !== uid && !admin;
        // 附件单独查询，避免把 storageKey 混进文章缓存；锁定状态只暴露数量。
        const attachments = await profileAsync(c, "feed_detail_attachments", () => listFeedAttachmentMeta(db, feed.id));

        // update visits using HyperLogLog for efficient UV estimation
        const enableVisit = await profileAsync(c, 'feed_detail_counter_flag', () => clientConfig.getOrDefault('counter.enabled', true));
        let pv = 0;
        let uv = 0;

        if (enableVisit) {
            const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || "UNK";
            const visitorKey = `${ip}`;

            // Get or create visit stats for this feed
            let stats = await profileAsync(c, 'feed_detail_stats_lookup', () => db.query.visitStats.findFirst({
                where: eq(visitStats.feedId, feed.id)
            }));

            if (!stats) {
                // Create new stats record
                await profileAsync(c, 'feed_detail_stats_insert', () => db.insert(visitStats).values({
                    feedId: feed.id,
                    pv: 1,
                    hllData: new HyperLogLog().serialize()
                }));
                pv = 1;
                uv = 1;
            } else {
                // Update existing stats
                const hll = new HyperLogLog(stats.hllData);
                hll.add(visitorKey);
                const newHllData = hll.serialize();
                const newPv = stats.pv + 1;

                await profileAsync(c, 'feed_detail_stats_update', () => db.update(visitStats)
                    .set({
                        pv: newPv,
                        hllData: newHllData,
                        updatedAt: new Date()
                    })
                    .where(eq(visitStats.feedId, feed.id)));

                pv = newPv;
                uv = Math.round(hll.count());
            }

            // Keep recording to visits table for backup/history
            await profileAsync(c, 'feed_detail_visit_insert', () => db.insert(visits).values({ feedId: feed.id, ip: ip }));
        }

        if (locked) {
            return c.json({
                ...other,
                content: "",
                summary: "",
                ai_summary: "",
                ai_summary_error: "",
                passwordProtected: true,
                locked: true,
                attachmentCount: attachments.length,
                hashtags: hashtags_flatten,
                pv,
                uv,
            });
        }

        return c.json({
            ...other,
            passwordProtected,
            locked: false,
            attachments,
            hashtags: hashtags_flatten,
            pv,
            uv,
        });
    });

    // POST /feed/:id/unlock - 使用密码解锁文章正文
    app.post('/:id/unlock', withJsonBody<{ password: string }>(feedUnlockSchema, async (c, body) => {
        const db = c.get('db');
        const admin = c.get('admin');
        const uid = c.get('uid');
        const id = c.req.param('id');

        const id_num = parseFeedId(id);
        if (id_num === null) {
            return c.text('Not found', 404);
        }

        const feed = await profileAsync(c, 'feed_unlock_lookup', () => findFeedById(db, id_num));
        if (!feed) {
            return c.text('Not found', 404);
        }

        // 草稿仍然只允许作者或管理员读取，不能通过密码接口绕过草稿权限。
        if (feed.draft && feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        const attachments = await profileAsync(c, "feed_unlock_attachments", () => listFeedAttachmentMeta(db, id_num));

        if (!hasFeedPassword(feed.passwordHash)) {
            return c.json({
                content: feed.content,
                summary: feed.summary,
                ai_summary: feed.ai_summary,
                ai_summary_status: feed.ai_summary_status,
                ai_summary_error: feed.ai_summary_error,
                locked: false as const,
                attachments,
            });
        }

        const password = body.password.trim();
        if (!password) {
            return c.text('Password is required', 400);
        }

        const valid = await profileAsync(c, 'feed_unlock_verify', () =>
            verifyFeedPassword(password, feed.passwordHash));

        if (!valid) {
            return c.text('Invalid password', 401);
        }

        // 解锁成功后签发短期下载凭证，游客凭它下载该文章下的所有附件。
        const downloadToken = await profileAsync(c, "feed_unlock_download_token", () =>
            createFeedDownloadToken(c.get("env"), id_num));

        return c.json({
            content: feed.content,
            summary: feed.summary,
            ai_summary: feed.ai_summary,
            ai_summary_status: feed.ai_summary_status,
            ai_summary_error: feed.ai_summary_error,
            locked: false as const,
            attachments,
            downloadToken: downloadToken.token,
            downloadTokenExpiresAt: downloadToken.expiresAt,
        });
    }));

    // GET /feed/adjacent/:id
    app.get("/adjacent/:id", async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const id = c.req.param('id');
        let id_num = parseFeedId(id);

        if (id_num === null) {
            const aliasRecord = await profileAsync(c, 'feed_adjacent_alias_lookup', () => db.select({ id: feeds.id }).from(feeds).where(eq(feeds.alias, id)));
            if (aliasRecord.length === 0) {
                return c.text("Not found", 404);
            }
            id_num = aliasRecord[0].id;
        }

        const feed = await profileAsync(c, 'feed_adjacent_current', () => db.query.feeds.findFirst({
            where: eq(feeds.id, id_num),
            columns: { createdAt: true },
        }));

        if (!feed) {
            return c.text("Not found", 404);
        }

        const created_at = feed.createdAt;

        function formatAndCacheData(feed: any, feedDirection: "previous_feed" | "next_feed") {
            if (feed) {
                const hashtags_flatten = feed.hashtags.map((f: any) => f.hashtag);
                const passwordProtected = hasFeedPassword(feed.passwordHash);
                const plainText = stripMarkdown(feed.content);
                const summary = passwordProtected
                    ? ""
                    : feed.summary.length > 0
                        ? feed.summary
                        : plainText.length > 50 ? plainText.slice(0, 50) : plainText;
                const cacheKey = `${feed.id}_${feedDirection}_${id_num}`;
                const cacheData = {
                    id: feed.id,
                    title: feed.title,
                    summary: summary,
                    hashtags: hashtags_flatten,
                    passwordProtected,
                    createdAt: feed.createdAt,
                    updatedAt: feed.updatedAt,
                };
                cache.set(cacheKey, cacheData);
                return cacheData;
            }
            return null;
        }

        const getPreviousFeed = async () => {
            const previousFeedCached = await profileAsync(c, 'feed_adjacent_prev_cache', () => cache.getBySuffix(`previous_feed_${id_num}`));
            if (previousFeedCached && previousFeedCached.length > 0) {
                return previousFeedCached[0];
            } else {
                const tempPreviousFeed = await profileAsync(c, 'feed_adjacent_prev_db', () => db.query.feeds.findFirst({
                    where: and(and(eq(feeds.draft, 0), eq(feeds.listed, 1)), lt(feeds.createdAt, created_at)),
                    orderBy: [desc(feeds.createdAt)],
                    with: {
                        hashtags: {
                            columns: {},
                            with: { hashtag: { columns: { id: true, name: true } } }
                        },
                        user: { columns: { id: true, username: true, avatar: true } }
                    },
                }));
                return formatAndCacheData(tempPreviousFeed, "previous_feed");
            }
        };

        const getNextFeed = async () => {
            const nextFeedCached = await profileAsync(c, 'feed_adjacent_next_cache', () => cache.getBySuffix(`next_feed_${id_num}`));
            if (nextFeedCached && nextFeedCached.length > 0) {
                return nextFeedCached[0];
            } else {
                const tempNextFeed = await profileAsync(c, 'feed_adjacent_next_db', () => db.query.feeds.findFirst({
                    where: and(and(eq(feeds.draft, 0), eq(feeds.listed, 1)), gt(feeds.createdAt, created_at)),
                    orderBy: [asc(feeds.createdAt)],
                    with: {
                        hashtags: {
                            columns: {},
                            with: { hashtag: { columns: { id: true, name: true } } }
                        },
                        user: { columns: { id: true, username: true, avatar: true } }
                    },
                }));
                return formatAndCacheData(tempNextFeed, "next_feed");
            }
        };

        const [previousFeed, nextFeed] = await Promise.all([getPreviousFeed(), getNextFeed()]);
        return c.json({ previousFeed, nextFeed });
    });

    // POST /feed/:id - Update feed
    app.post('/:id', userOnly(withJsonBody<UpdateFeedRequest>(feedUpdateSchema, async (c, body) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const serverConfig = c.get('serverConfig');
        const env = c.get('env');
        const admin = c.get('admin');
        const uid = c.get('uid')!;
        const id = c.req.param('id');
        const { title, listed, content, summary, alias, draft, top, tags, createdAt, passwordEnabled, password } = body;

        const id_num = parseFeedId(id);
        if (id_num === null) {
            return c.text('Not found', 404);
        }
        const feed = await profileAsync(c, 'feed_update_lookup', () => findFeedById(db, id_num));

        if (!feed) {
            return c.text('Not found', 404);
        }

        if (feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        const passwordProtected = hasFeedPassword(feed.passwordHash);
        let passwordHash: string | null | undefined;
        if (passwordEnabled === false) {
            // 明确关闭密码访问时清空哈希，文章恢复为公开阅读。
            passwordHash = null;
        } else if (typeof password === 'string' && password.trim()) {
            passwordHash = await profileAsync(c, 'feed_update_password_hash', () =>
                createFeedPasswordHash(password.trim()));
        } else if (passwordEnabled === true && !passwordProtected) {
            // 开启密码访问却没有填写密码，不能静默创建一篇“看似受保护”的文章。
            return c.text('Password is required', 400);
        }

        const contentChanged = content && content !== feed.content;
        const isDraft = draft !== undefined ? draft : (feed.draft === 1);
        const shouldQueueAISummary = (contentChanged && !isDraft) || (!isDraft && feed.draft === 1 && !feed.ai_summary);
        const updateTime = new Date();

        await profileAsync(c, 'feed_update_db', () => updateFeedById(db, id_num, {
            title,
            content,
            summary,
            ai_summary: shouldQueueAISummary ? "" : undefined,
            ai_summary_status: isDraft ? "idle" : undefined,
            ai_summary_error: shouldQueueAISummary || isDraft ? "" : undefined,
            alias,
            top,
            passwordHash,
            listed: listed ? 1 : 0,
            draft: draft === undefined ? undefined : draft ? 1 : 0,
            createdAt: createdAt ? new Date(createdAt) : undefined,
            updatedAt: updateTime
        }));

        if (tags) {
            await profileAsync(c, 'feed_update_tags', () => bindTagToPost(db, id_num, tags));
        }

        if (shouldQueueAISummary || isDraft) {
            await profileAsync(c, 'feed_update_ai_queue', () => syncFeedAISummaryQueueState(db, serverConfig, env, id_num, {
                draft: Boolean(isDraft),
                updatedAt: updateTime,
                resetSummary: shouldQueueAISummary,
            }));
        }

        await profileAsync(c, 'feed_update_cache_invalidate', () => clearFeedCache(cache, id_num, feed.alias, alias || null));

        if (feed.draft === 1 && draft === false) {
            const frontendUrl = env.FRONTEND_URL || new URL(c.req.url).origin;
            const publishedTitle = title || feed.title || "无标题文章";
            try {
                await profileAsync(c, 'feed_update_mail', () => sendEventMail(serverConfig, "feed", {
                    subject: `新文章：${publishedTitle}`,
                    html: `<p>发布了新文章 <strong>${escapeHtml(publishedTitle)}</strong></p><p><a href="${escapeHtml(`${frontendUrl}/feed/${alias || feed.alias || id_num}`)}">阅读全文</a></p>`,
                }));
            } catch (error) {
                console.error("Failed to send feed mail", error);
            }
        }

        return c.text('Updated');
    }), { message: 'Permission denied', status: 403 }));

    // POST /feed/top/:id
    app.post('/top/:id', userOnly(withJsonBody<{ top: number }>(feedSetTopSchema, async (c, body) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const uid = c.get('uid')!;
        const id = c.req.param('id');
        const { top } = body;

        const id_num = parseFeedId(id);
        if (id_num === null) {
            return c.text('Not found', 404);
        }
        const feed = await profileAsync(c, 'feed_top_lookup', () => findFeedById(db, id_num));

        if (!feed) {
            return c.text('Not found', 404);
        }

        if (feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        await profileAsync(c, 'feed_top_db', () => updateFeedById(db, feed.id, { top }));
        await profileAsync(c, 'feed_top_cache_invalidate', () => clearFeedCache(cache, feed.id, feed.alias, feed.alias));
        return c.text('Updated');
    }), { message: 'Permission denied', status: 403 }));

    // POST /feed/sort/:id
    app.post('/sort/:id', userOnly(withJsonBody<{ sortOrder: number }>(feedSetSortSchema, async (c, body) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const uid = c.get('uid')!;
        const id = c.req.param('id');
        const { sortOrder } = body;

        const id_num = parseFeedId(id);
        if (id_num === null) {
            return c.text('Not found', 404);
        }
        const feed = await profileAsync(c, 'feed_sort_lookup', () => findFeedById(db, id_num));

        if (!feed) {
            return c.text('Not found', 404);
        }

        if (feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        await profileAsync(c, 'feed_sort_db', () => updateFeedById(db, feed.id, { sortOrder }));
        await profileAsync(c, 'feed_sort_cache_invalidate', () => clearFeedCache(cache, feed.id, feed.alias, feed.alias));
        return c.text('Updated');
    }), { message: 'Permission denied', status: 403 }));

    // DELETE /feed/:id
    app.delete('/:id', userOnly(async (c, uid) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const id = c.req.param('id');

        const id_num = parseFeedId(id);
        if (id_num === null) {
            return c.text('Not found', 404);
        }
        const feed = await profileAsync(c, 'feed_delete_lookup', () => findFeedById(db, id_num));

        if (!feed) {
            return c.text('Not found', 404);
        }

        if (feed.uid !== uid && !admin) {
            return c.text('Permission denied', 403);
        }

        // 删除文章前先清理附件对象；数据库层的外键级联只负责删除元数据。
        const attachments = await profileAsync(c, 'feed_delete_attachments', () => listFeedAttachmentRows(db, id_num));
        await profileAsync(c, 'feed_delete_attachment_objects', async () => {
            for (const attachment of attachments) {
                try {
                    await deleteStorageObject(c.get('env'), attachment.storageKey);
                } catch (error) {
                    console.error(`Feed attachment cleanup failed for ${attachment.id}:`, error);
                }
            }
        });

        await profileAsync(c, 'feed_delete_db', () => deleteFeedById(db, id_num));
        await profileAsync(c, 'feed_delete_cache_invalidate', () => clearFeedCache(cache, id_num, feed.alias, null));
        return c.text('Deleted');
    }, { message: 'Permission denied', status: 403 }));
    return app;
}

export function SearchService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /search/:keyword
    app.get('/:keyword', async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const admin = c.get('admin');
        const page = c.req.query('page');
        const limit = c.req.query('limit');
        let keyword = c.req.param('keyword');

        keyword = decodeURI(keyword);
        const page_num = parsePositiveInteger(page, 1) - 1;
        const limit_num = parsePositiveInteger(limit, 20, 50);

        if (keyword === undefined || keyword.trim().length === 0) {
            return c.json({ size: 0, data: [], hasNext: false });
        }

        const scope = admin ? 'admin' : 'public';
        const cacheKey = `search_${scope}_${page_num}_${limit_num}_${encodeURIComponent(keyword)}`;
        const result = await profileAsync(c, 'feed_search_cache_db', () => cache.getOrSet(cacheKey, async () => {
            const pageResult = await searchFeedPage(db, {
                keyword,
                admin,
                pageIndex: page_num,
                limit: limit_num,
            });
            const data = pageResult.rows.map(({ content, hashtags, summary, passwordHash, ...other }: any) => {
                const passwordProtected = hasFeedPassword(passwordHash);
                const locked = passwordProtected && !admin;
                const plainText = locked ? "" : stripMarkdown(content);
                return {
                    summary: locked ? "" : summary.length > 0 ? summary : plainText.length > 100 ? plainText.slice(0, 100) : plainText,
                    hashtags: hashtags.map(({ hashtag }: any) => hashtag),
                    passwordProtected,
                    ...other,
                };
            });

            return { size: pageResult.size, data, hasNext: pageResult.hasNext };
        }));

        return c.json(result);
    });
    return app;
}


export function WordPressService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // POST /wp - WordPress import
    app.post('/', adminOnly(async (c) => {
        const db = c.get('db');
        const cache = c.get('cache');
        const body = await profileAsync(c, 'wp_import_parse', () => c.req.parseBody());
        const data = body.data as File;

        if (!data) {
            return c.text('Data is required', 400);
        }

        // Initialize WordPress import modules lazily
        await profileAsync(c, 'wp_import_modules', () => initWPModules());

        const xml = await profileAsync(c, 'wp_import_read', () => data.text());
        const parser = new XMLParser();
        const result = await profileAsync(c, 'wp_import_xml_parse', () => parser.parse(xml));
        const items = result.rss.channel.item;

        if (!items) {
            return c.text('No items found', 404);
        }

        const feedItems: FeedItem[] = items?.map((item: any) => {
            const createdAt = new Date(item?.['wp:post_date']);
            const updatedAt = new Date(item?.['wp:post_modified']);
            const draft = item?.['wp:status'] !== 'publish';
            const contentHtml = item?.['content:encoded'];
            const content = html2md(contentHtml);
            const summary = content.length > 100 ? content.slice(0, 100) : content;
            let tags = item?.['category'];

            if (tags && Array.isArray(tags)) {
                tags = tags.map((tag: any) => tag + '');
            } else if (tags && typeof tags === 'string') {
                tags = [tags];
            }

            return {
                title: item.title,
                summary,
                content,
                draft,
                createdAt,
                updatedAt,
                tags
            };
        });

        let success = 0;
        let skipped = 0;
        let skippedList: { title: string, reason: string }[] = [];

        for (const item of feedItems) {
            if (!item.content) {
                skippedList.push({ title: item.title, reason: "no content" });
                skipped++;
                continue;
            }

            const exist = await profileAsync(c, 'wp_import_existing', () => db.query.feeds.findFirst({ where: eq(feeds.content, item.content) }));
            if (exist) {
                skippedList.push({ title: item.title, reason: "content exists" });
                skipped++;
                continue;
            }

            const result = await profileAsync(c, 'wp_import_insert', () => db.insert(feeds).values({
                title: item.title,
                content: item.content,
                summary: item.summary,
                uid: 1,
                listed: 1,
                draft: item.draft ? 1 : 0,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            }).returning({ insertedId: feeds.id }));

            if (item.tags) {
                const tags = item.tags;
                await profileAsync(c, 'wp_import_tags', () => bindTagToPost(db, result[0].insertedId, tags));
            }
            success++;
        }

        await profileAsync(c, 'wp_import_cache_invalidate', () => clearFeedCollectionCaches(cache));
        return c.json({ success, skipped, skippedList });
    }, { message: 'Permission denied', status: 403 }));
    return app;
}

type FeedItem = {
    title: string;
    summary: string;
    content: string;
    draft: boolean;
    createdAt: Date;
    updatedAt: Date;
    tags?: string[];
}
