// Request/Response schemas for server-side validation
import { t } from './schema-validator';

// ============================================================================
// Feed Schemas
// ============================================================================

export const feedListSchema = t.Object({
  page: t.Number({ optional: true }),
  limit: t.Number({ optional: true }),
  type: t.String({ optional: true }),
});

export const feedCreateSchema = t.Object({
  title: t.String({ minLength: 1 }),
  content: t.String({ minLength: 1 }),
  summary: t.String({ optional: true }),
  alias: t.String({ optional: true }),
  draft: t.Boolean(),
  listed: t.Boolean(),
  createdAt: t.Date({ optional: true }),
  tags: t.Array(t.String()),
  // 文章访问密码；非空时启用密码保护。
  password: t.String({ optional: true }),
});

export const feedUpdateSchema = t.Object({
  title: t.String({ optional: true }),
  alias: t.String({ optional: true }),
  content: t.String({ optional: true }),
  summary: t.String({ optional: true }),
  listed: t.Boolean(),
  draft: t.Boolean({ optional: true }),
  createdAt: t.Date({ optional: true }),
  tags: t.Array(t.String(), { optional: true }),
  top: t.Numeric({ optional: true }),
  // 关闭密码访问时传 false；开启时传 true，password 为空代表沿用旧密码。
  passwordEnabled: t.Boolean({ optional: true }),
  password: t.String({ optional: true }),
});

export const feedUnlockSchema = t.Object({
  password: t.String({ minLength: 1 }),
});

export const feedSetTopSchema = t.Object({
  top: t.Numeric(),
});

export const feedSetSortSchema = t.Object({
  sortOrder: t.Numeric(),
});

// ============================================================================
// Auth Schemas
// ============================================================================

export const loginSchema = t.Object({
  username: t.String(),
  password: t.String(),
});

// ============================================================================
// User Schemas
// ============================================================================

export const updateProfileSchema = t.Object({
  username: t.String({ optional: true }),
  avatar: t.String({ optional: true }),
});

// ============================================================================
// Comment Schemas
// ============================================================================

export const commentCreateSchema = t.Object({
  content: t.String(),
  guestName: t.String({ optional: true }),
  guestEmail: t.String({ optional: true }),
  guestWebsite: t.String({ optional: true }),
});

// ============================================================================
// Friend Schemas
// ============================================================================

export const friendCreateSchema = t.Object({
  name: t.String(),
  desc: t.String(),
  avatar: t.String(),
  url: t.String(),
});

export const friendUpdateSchema = t.Object({
  name: t.String(),
  desc: t.String(),
  avatar: t.String({ optional: true }),
  url: t.String(),
  accepted: t.Numeric({ optional: true }),
  sort_order: t.Numeric({ optional: true }),
});

// ============================================================================
// Moment Schemas
// ============================================================================

export const momentCreateSchema = t.Object({
  content: t.String(),
});

export const momentUpdateSchema = t.Object({
  content: t.String(),
});

// ============================================================================
// AI Config Schemas
// ============================================================================

export const aiConfigUpdateSchema = t.Object({
  enabled: t.Boolean({ optional: true }),
  provider: t.String({ optional: true }),
  model: t.String({ optional: true }),
  api_key: t.String({ optional: true }),
  api_url: t.String({ optional: true }),
});

// ============================================================================
// WordPress Import Schemas
// ============================================================================

export const wpImportSchema = t.Object({
  data: t.File(),
});

// ============================================================================
// Search Schemas
// ============================================================================

export const searchSchema = t.Object({
  page: t.Number({ optional: true }),
  limit: t.Number({ optional: true }),
});
