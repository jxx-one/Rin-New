import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

const created_at = integer("created_at", { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull();
const updated_at = integer("updated_at", { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull();

export const feeds = sqliteTable("feeds", {
    id: integer("id").primaryKey(),
    alias: text("alias"),
    title: text("title"),
    summary: text("summary").default("").notNull(),
    ai_summary: text("ai_summary").default("").notNull(),
    ai_summary_status: text("ai_summary_status").default("idle").notNull(),
    ai_summary_error: text("ai_summary_error").default("").notNull(),
    content: text("content").notNull(),
    listed: integer("listed").default(1).notNull(),
    draft: integer("draft").default(1).notNull(),
    top: integer("top").default(0).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    // 文章访问密码哈希；为空表示不启用密码访问。格式见 utils/feed-password.ts。
    passwordHash: text("password_hash"),
    uid: integer("uid").references(() => users.id).notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    aliasIdx: index("feeds_alias_idx").on(table.alias),
    visibilityOrderIdx: index("feeds_visibility_order_idx").on(
        table.draft,
        table.listed,
        table.top,
        table.sortOrder,
        table.createdAt,
        table.updatedAt,
    ),
    uidIdx: index("feeds_uid_idx").on(table.uid),
}));

/**
 * 文章附件表。
 *
 * 附件文件本身存放在私有对象存储中，数据库只保存元数据和 storage_key。
 * storage_key 绝不能返回给前台，否则会绕过文章密码直接访问文件。
 */
export const feedAttachments = sqliteTable("feed_attachments", {
    id: integer("id").primaryKey(),
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: "cascade" }).notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").default("application/octet-stream").notNull(),
    size: integer("size").notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    feedCreatedAtIdx: index("feed_attachments_feed_created_at_idx").on(table.feedId, table.createdAt),
}));

export const moments = sqliteTable("moments", {
    id: integer("id").primaryKey(),
    content: text("content").notNull(),
    uid: integer("uid").references(() => users.id).notNull(),
    createdAt: created_at,
    updatedAt: updated_at
});

export const visits = sqliteTable("visits", {
    id: integer("id").primaryKey(),
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: 'cascade' }).notNull(),
    ip: text("ip").notNull(),
    createdAt: created_at,
}, (table) => ({
    feedCreatedAtIdx: index("visits_feed_created_at_idx").on(table.feedId, table.createdAt),
}));

export const visitStats = sqliteTable("visit_stats", {
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: 'cascade' }).notNull().primaryKey(),
    pv: integer("pv").default(0).notNull(),
    hllData: text("hll_data").default("").notNull(),
    updatedAt: updated_at,
});

export const info = sqliteTable("info", {
    key: text("key").notNull().unique(),
    value: text("value").notNull(),
});

export const friends = sqliteTable("friends", {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    desc: text("desc"),
    avatar: text("avatar").notNull(),
    url: text("url").notNull(),
    uid: integer("uid").references(() => users.id, { onDelete: 'cascade' }).notNull(),
    accepted: integer("accepted").default(0).notNull(),
    health: text("health").default("").notNull(),
    sort_order: integer("sort_order").default(0).notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    acceptedOrderIdx: index("friends_accepted_order_idx").on(
        table.accepted,
        table.sort_order,
        table.createdAt,
    ),
}));

export const users = sqliteTable("users", {
    id: integer("id").primaryKey(),
    username: text("username").notNull(),
    openid: text("openid").notNull(),
    avatar: text("avatar"),
    password: text("password"),
    // 用户邮箱统一保存为小写；为空表示尚未绑定。邮箱用于登录后的资料展示、邮箱验证注册和更换邮箱。
    email: text("email"),
    // 邮箱完成验证码校验的时间；旧用户或仅 GitHub 登录用户可能为空。
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp" }),
    permission: integer("permission").default(0),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    openidIdx: index("users_openid_idx").on(table.openid),
    // SQLite 唯一索引允许多个 NULL，因此未绑定邮箱的用户不会互相冲突。
    emailUnique: unique("users_email_unique").on(table.email),
}));

/**
 * 邮箱验证码记录。
 *
 * 同一邮箱同一用途可能产生多条记录，校验时只取最新一条未消费记录；
 * 这样重新发送验证码不会误删上一封邮件的旧记录，也便于实现发送冷却和错误次数限制。
 */
export const emailVerifications = sqliteTable("email_verifications", {
    id: integer("id").primaryKey(),
    email: text("email").notNull(),
    // 用途：register（邮箱注册）或 email_change（登录后更换邮箱）。
    purpose: text("purpose").notNull(),
    // 验证码使用 HMAC 保存，不落明文；格式见 utils/email-verification.ts。
    codeHash: text("code_hash").notNull(),
    // 过期时间，单位为秒级时间戳。
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    // 已尝试校验次数，超过上限后该验证码失效。
    attempts: integer("attempts").default(0).notNull(),
    // 成功消费时间；为空表示仍可使用。
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    createdAt: created_at,
}, (table) => ({
    emailPurposeCreatedIdx: index("email_verifications_email_purpose_created_idx").on(
        table.email,
        table.purpose,
        table.createdAt,
    ),
}));

export const comments = sqliteTable("comments", {
    id: integer("id").primaryKey(),
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: 'cascade' }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: 'cascade' }),
    content: text("content").notNull(),
    guestName: text("guest_name").default(""),
    guestEmail: text("guest_email").default(""),
    guestWebsite: text("guest_website").default(""),
    approved: integer("approved").default(1).notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    feedCreatedAtIdx: index("comments_feed_created_at_idx").on(table.feedId, table.createdAt),
}));

export const hashtags = sqliteTable("hashtags", {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    nameIdx: index("hashtags_name_idx").on(table.name),
}));

export const feedHashtags = sqliteTable("feed_hashtags", {
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: 'cascade' }).notNull(),
    hashtagId: integer("hashtag_id").references(() => hashtags.id, { onDelete: 'cascade' }).notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    feedHashtagIdx: index("feed_hashtags_feed_hashtag_idx").on(table.feedId, table.hashtagId),
    hashtagFeedIdx: index("feed_hashtags_hashtag_feed_idx").on(table.hashtagId, table.feedId),
}));

export const cache = sqliteTable("cache", {
    id: integer("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    type: text("type").default("cache").notNull(),
    createdAt: created_at,
    updatedAt: updated_at,
}, (table) => ({
    // 复合唯一约束：key + type
    keyTypeUnique: unique().on(table.key, table.type),
    typeKeyIdx: index("cache_type_key_idx").on(table.type, table.key),
}));

export const feedsRelations = relations(feeds, ({ many, one }) => ({
    hashtags: many(feedHashtags),
    user: one(users, {
        fields: [feeds.uid],
        references: [users.id],
    }),
    comments: many(comments),
    attachments: many(feedAttachments),
}));

export const feedAttachmentsRelations = relations(feedAttachments, ({ one }) => ({
    feed: one(feeds, {
        fields: [feedAttachments.feedId],
        references: [feeds.id],
    }),
}));

export const momentsRelations = relations(moments, ({ one }) => ({
    user: one(users, {
        fields: [moments.uid],
        references: [users.id],
    })
}));

export const commentsRelations = relations(comments, ({ one }) => ({
    feed: one(feeds, {
        fields: [comments.feedId],
        references: [feeds.id],
    }),
    user: one(users, {
        fields: [comments.userId],
        references: [users.id],
    }),
}));

export const hashtagsRelations = relations(hashtags, ({ many }) => ({
    feeds: many(feedHashtags),
}));

export const feedHashtagsRelations = relations(feedHashtags, ({ one }) => ({
    feed: one(feeds, {
        fields: [feedHashtags.feedId],
        references: [feeds.id],
    }),
    hashtag: one(hashtags, {
        fields: [feedHashtags.hashtagId],
        references: [hashtags.id],
    }),
}));
