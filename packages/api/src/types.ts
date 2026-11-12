// ============================================================================
// Shared API Types - Used by both client and server
// ============================================================================

// Common types
export interface ApiResponse<T> {
  data?: T;
  error?: {
    status: number;
    value: string;
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

// ============================================================================
// Feed Types
// ============================================================================

// 文章附件对前台暴露的元数据。storageKey 和真实存储地址永远不返回。
export interface FeedAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Feed {
  id: number;
  title: string | null;
  content: string;
  uid: number;
  createdAt: string;
  updatedAt: string;
  ai_summary: string;
  ai_summary_status: "idle" | "pending" | "processing" | "completed" | "failed";
  ai_summary_error: string;
  hashtags: Array<{ id: number; name: string }>;
  user: {
    avatar: string | null;
    id: number;
    username: string;
  };
  pv: number;
  uv: number;
  top?: number;
  // 文章是否设置了访问密码。作者/管理员也能看到该标记，用于编辑页显示“已设置”。
  passwordProtected?: boolean;
  // 当前响应是否被密码锁定：为 true 时 content / summary / ai_summary 已被清空。
  locked?: boolean;
  // 未锁定时返回附件元数据；锁定状态只返回 attachmentCount。
  attachments?: FeedAttachment[];
  attachmentCount?: number;
  // 游客解锁文章后拿到的短期附件下载凭证，只保存在组件内存中。
  downloadToken?: string;
  downloadTokenExpiresAt?: string;
}

export interface FeedListResponse {
  size: number;
  data: Array<{
    id: number;
    title: string | null;
    summary: string;
    hashtags: Array<{ id: number; name: string }>;
    user: {
      avatar: string | null;
      id: number;
      username: string;
    };
    avatar: string | null;
    createdAt: string;
    updatedAt: string;
    pv: number;
    uv: number;
    sortOrder?: number;
    top?: number;
    draft?: number;
    listed?: number;
    // 启用密码访问时为 true；列表中的 summary / avatar 会被隐藏，避免摘要泄露正文。
    passwordProtected?: boolean;
  }>;
  hasNext: boolean;
}

export interface TimelineItem {
  id: number;
  title: string | null;
  createdAt: string;
}

export interface CreateFeedRequest {
  title: string;
  content: string;
  summary?: string;
  alias?: string;
  draft: boolean;
  listed: boolean;
  createdAt?: string;
  tags: string[];
  // 非空时启用文章密码访问；留空表示不启用。
  password?: string;
}

export interface UpdateFeedRequest {
  title?: string;
  content?: string;
  summary?: string;
  alias?: string;
  listed: boolean;
  draft?: boolean;
  createdAt?: string;
  tags?: string[];
  top?: number;
  // false 表示移除密码保护；true 且 password 为空表示沿用原密码。
  passwordEnabled?: boolean;
  // 非空时更新密码；空字符串表示不修改已有密码。
  password?: string;
}

// 密码验证成功后只返回被隐藏的正文相关字段，其他元信息沿用初次 GET 的结果。
export interface FeedUnlockResponse {
  content: string;
  summary: string;
  ai_summary: string;
  ai_summary_status: "idle" | "pending" | "processing" | "completed" | "failed";
  ai_summary_error: string;
  locked: false;
  // 解锁后直接返回附件列表；有密码时同时签发短期下载凭证。
  attachments?: FeedAttachment[];
  downloadToken?: string;
  downloadTokenExpiresAt?: string;
}

export interface AdjacentFeed {
  id: number;
  title: string | null;
  summary: string;
  hashtags: Array<{ id: number; name: string }>;
  passwordProtected?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdjacentFeedResponse {
  previousFeed: AdjacentFeed | null;
  nextFeed: AdjacentFeed | null;
}

// ============================================================================
// User Types
// ============================================================================

export interface UserProfile {
  id: number;
  username: string;
  avatar: string | null;
  /** 已绑定邮箱；未绑定为 null。 */
  email: string | null;
  /** 是否已有密码；仅 GitHub 注册的用户可能为 false。 */
  hasPassword: boolean;
  permission: boolean;
}

export interface UpdateProfileRequest {
  username?: string;
  avatar?: string | null;
  /** 新邮箱；与当前邮箱不同时必须同时提交 emailCode。 */
  email?: string;
  /** 发送到新邮箱的 6 位验证码。 */
  emailCode?: string;
  /** 已设置密码的用户修改密码时必须提供当前密码。 */
  currentPassword?: string;
  /** 新密码；至少 8 位。 */
  newPassword?: string;
}

export interface UpdateProfileResponse {
  success: boolean;
  username: string;
  email: string | null;
}

/** 管理员用户列表项；不包含密码哈希等敏感字段。 */
export interface AdminUserSummary {
  id: number;
  username: string;
  avatar: string | null;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  permission: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListResponse {
  data: AdminUserSummary[];
  page: number;
  limit: number;
  hasNext: boolean;
  search: string;
}

/** 管理员编辑用户资料；密码留空表示不修改，邮箱留空表示解除绑定。 */
export interface AdminUpdateUserRequest {
  username?: string;
  avatar?: string | null;
  email?: string | null;
  newPassword?: string;
  permission?: boolean;
}

export interface AdminUpdateUserResponse {
  success: boolean;
  user: AdminUserSummary;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthStatus {
  github: boolean;
  password: boolean;
  /** 管理员已开启注册且邮件服务可用。 */
  register: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user: UserProfile;
}

export interface RegisterCodeRequest {
  email: string;
}

export interface RegisterCodeResponse {
  success: boolean;
  expiresIn: number;
  resendAfter: number;
  maxAttempts?: number;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  code: string;
}

// ============================================================================
// Tag Types
// ============================================================================

export interface Tag {
  id: number;
  name: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagDetail extends Tag {
  feeds: Feed[];
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 登录用户的评论 */
  user?: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  } | null;
  /** 游客评论的昵称 */
  guestName?: string;
  /** 游客评论的邮箱 */
  guestEmail?: string;
  /** 游客评论的网站 */
  guestWebsite?: string;
  /** 审核状态 */
  approved: boolean;
}

export interface CreateCommentRequest {
  content: string;
  /** 游客昵称（未登录时必填） */
  guestName?: string;
  /** 游客邮箱（可选） */
  guestEmail?: string;
  /** 游客网站（可选） */
  guestWebsite?: string;
}

// ============================================================================
// Friend Types
// ============================================================================

export interface Friend {
  id: number;
  name: string;
  desc: string | null;
  avatar: string;
  url: string;
  accepted: number;
  sort_order: number | null;
  createdAt: string;
  uid: number;
  updatedAt: string;
  health: string;
}

export interface FriendListResponse {
  friend_list: Friend[];
  apply_list: Friend | null;
}

export interface CreateFriendRequest {
  name: string;
  desc: string;
  avatar: string;
  url: string;
}

export interface UpdateFriendRequest {
  name: string;
  desc: string;
  avatar?: string;
  url: string;
  accepted?: number;
  sort_order?: number;
}

// ============================================================================
// Moment Types
// ============================================================================

export interface Moment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    username: string;
    avatar: string;
  };
}

export interface CreateMomentRequest {
  content: string;
}

export interface MomentListResponse {
  data: Moment[];
  hasNext: boolean;
}

// ============================================================================
// Config Types
// ============================================================================

export type ConfigType = 'client' | 'server';

export interface ConfigResponse {
  [key: string]: any;
}

// ============================================================================
// AI Config Types
// ============================================================================

export interface AIConfig {
  enabled: boolean;
  provider: string;
  model: string;
  api_key: string;
  api_url: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface UploadResponse {
  url: string;
}

// ============================================================================
// Search Types
// ============================================================================

// Uses FeedListResponse

// ============================================================================
// WordPress Import Types
// ============================================================================

export interface WordPressImportResponse {
  success: number;
  skipped: number;
  skippedList: Array<{ title: string; reason: string }>;
}

// ============================================================================
// Feed Export / Import Types
// ============================================================================

export interface FeedExportItem {
  title: string | null;
  alias: string | null;
  content: string;
  summary: string;
  listed: number;
  draft: number;
  top: number;
  sortOrder: number;
  // 管理员备份时保留密码哈希，恢复后仍保持密码保护；旧备份没有该字段则视为未设置。
  passwordHash?: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface FeedExportPayload {
  version: number;
  generator?: string;
  exportedAt: string;
  feeds: FeedExportItem[];
}

export interface FeedImportResult {
  imported: number;
  skipped: number;
  total: number;
  skippedList: Array<{ title: string; reason: string }>;
}

// ============================================================================
// API Endpoint Paths
// ============================================================================

export const API_PATHS = {
  // Feed
  FEED_LIST: '/api/feed',
  FEED_TIMELINE: '/api/feed/timeline',
  FEED_GET: (id: number | string) => `/api/feed/${id}`,
  FEED_CREATE: '/api/feed',
  FEED_UPDATE: (id: number) => `/api/feed/${id}`,
  FEED_DELETE: (id: number) => `/api/feed/${id}`,
  FEED_ADJACENT: (id: number | string) => `/api/feed/adjacent/${id}`,
  FEED_SET_TOP: (id: number) => `/api/feed/top/${id}`,
  FEED_SET_SORT: (id: number) => `/api/feed/sort/${id}`,
  FEED_EXPORT: '/api/feed/export',
  FEED_IMPORT: '/api/feed/import',

  // Auth
  AUTH_STATUS: '/api/auth/status',
  AUTH_LOGIN: '/api/auth/login',
  AUTH_REGISTER_CODE: '/api/auth/register/code',
  AUTH_REGISTER: '/api/auth/register',

  // User
  USER_PROFILE: '/api/user/profile',
  USER_UPDATE_PROFILE: '/api/user/profile',
  USER_EMAIL_CODE: '/api/user/email/code',
  USER_ADMIN_LIST: '/api/user/admin/list',
  USER_ADMIN_UPDATE: (id: number) => `/api/user/admin/${id}`,
  USER_LOGOUT: '/api/user/logout',
  USER_GITHUB: '/api/user/github',

  // Tag
  TAG_LIST: '/api/tag',
  TAG_GET: (name: string) => `/api/tag/${encodeURIComponent(name)}`,

  // Comment
  COMMENT_LIST: (feedId: number) => `/api/comment/${feedId}`,
  COMMENT_CREATE: (feedId: number) => `/api/comment/${feedId}`,
  COMMENT_DELETE: (id: number) => `/api/comment/${id}`,

  // Friend
  FRIEND_LIST: '/api/friend',
  FRIEND_CREATE: '/api/friend',
  FRIEND_UPDATE: (id: number) => `/api/friend/${id}`,
  FRIEND_DELETE: (id: number) => `/api/friend/${id}`,

  // Moments
  MOMENTS_LIST: '/api/moments',
  MOMENTS_CREATE: '/api/moments',
  MOMENTS_UPDATE: (id: number) => `/api/moments/${id}`,
  MOMENTS_DELETE: (id: number) => `/api/moments/${id}`,

  // Config
  CONFIG_GET: (type: ConfigType) => `/config/${type}`,
  CONFIG_UPDATE: (type: ConfigType) => `/config/${type}`,
  CONFIG_CLEAR_CACHE: '/config/cache',
  CONFIG_TEST_MAIL: '/api/config/test-mail',

  // AI Config (deprecated - use CONFIG_GET/CONFIG_UPDATE with 'server' type instead)
  /** @deprecated Use CONFIG_GET('server') instead. AI config is now part of server config. */
  AI_CONFIG_GET: '/ai-config',
  /** @deprecated Use CONFIG_UPDATE('server', {...}) instead. AI config is now part of server config. */
  AI_CONFIG_UPDATE: '/ai-config',

  // Storage
  STORAGE_UPLOAD: '/storage',

  // Favicon
  FAVICON_GET: '/favicon',
  FAVICON_GET_ORIGINAL: '/favicon/original',
  FAVICON_UPLOAD: '/favicon',

  // Search
  SEARCH: (keyword: string) => `/search/${encodeURIComponent(keyword)}`,

  // WordPress
  WP_IMPORT: '/wp',

  // RSS
  RSS_GET: (name: string) => `/${encodeURIComponent(name)}`,
} as const;

export type APIEndpoint = typeof API_PATHS;
