// API Client for Rin - Type-safe HTTP client to replace Eden
// This client provides a clean, type-safe interface for all backend API endpoints

import { getAuthToken } from "../utils/auth";
import { endpoint } from "../config";

// Import shared types
import type {
  ApiResponse,
  RequestOptions,
  Feed,
  FeedListResponse,
  TimelineItem,
  CreateFeedRequest,
  UpdateFeedRequest,
  AdjacentFeedResponse,
  UserProfile,
  UpdateProfileRequest,
  UpdateProfileResponse,
  AdminUserListResponse,
  AdminUpdateUserRequest,
  AdminUpdateUserResponse,
  RegisterCodeRequest,
  RegisterCodeResponse,
  RegisterRequest,
  Tag,
  TagDetail,
  Comment,
  CreateCommentRequest,
  Friend,
  FriendListResponse,
  CreateFriendRequest,
  UpdateFriendRequest,
  Moment,
  CreateMomentRequest,
  ConfigType,
  ConfigResponse,
  AIConfig,
  UploadResponse,
  AuthStatus,
  LoginRequest,
  LoginResponse,
  FeedExportPayload,
  FeedImportResult,
  FeedUnlockResponse,
  FeedAttachment,
} from "@rin/api";

export interface SettingsConfigResponse {
  clientConfig: ConfigResponse;
  serverConfig: ConfigResponse;
}

export interface ConfigHealthItem {
  id: string;
  title: {
    key: string;
    values?: Record<string, string | number | boolean>;
  };
  status: "success" | "warning" | "danger";
  configured: boolean;
  impact: {
    key: string;
    values?: Record<string, string | number | boolean>;
  };
  summary: {
    key: string;
    values?: Record<string, string | number | boolean>;
  };
  suggestion?: {
    key: string;
    values?: Record<string, string | number | boolean>;
  };
  details?: Array<{
    key: string;
    values?: Record<string, string | number | boolean>;
  }>;
}

export interface ConfigHealthResponse {
  generatedAt: string;
  summary: Record<"success" | "warning" | "danger", number>;
  items: ConfigHealthItem[];
}

export interface QueueStatusItem {
  id: number;
  title: string | null;
  aiSummaryStatus: "idle" | "pending" | "processing" | "completed" | "failed";
  aiSummaryError: string;
  updatedAt: string;
  createdAt: string;
}

export interface QueueStatusResponse {
  queueConfigured: boolean;
  generatedAt: string;
  summary: Record<"idle" | "pending" | "processing" | "completed" | "failed", number>;
  items: QueueStatusItem[];
}

export interface QueueTaskActionResponse {
  success: boolean;
}

export interface CompatTasksResponse {
  generatedAt: string;
  aiSummary: {
    enabled: boolean;
    queueConfigured: boolean;
    eligible: number;
    forceEligible: number;
  };
  blurhash: {
    eligible: number;
  };
}

export interface CompatAISummaryActionResponse {
  queued: number;
  skipped: number;
  forced: boolean;
}

export interface CompatBlurhashCandidate {
  id: number;
  title: string | null;
  content: string;
}

export interface CompatBlurhashCandidatesResponse {
  generatedAt: string;
  items: CompatBlurhashCandidate[];
}

export interface CompatBlurhashApplyResponse {
  updated: boolean;
}

// Re-export for external use
export type {
  ApiResponse,
  RequestOptions,
  Feed,
  FeedListResponse,
  TimelineItem,
  CreateFeedRequest,
  UpdateFeedRequest,
  AdjacentFeedResponse,
  UserProfile,
  UpdateProfileRequest,
  UpdateProfileResponse,
  AdminUserListResponse,
  AdminUpdateUserRequest,
  AdminUpdateUserResponse,
  RegisterCodeRequest,
  RegisterCodeResponse,
  RegisterRequest,
  Tag,
  TagDetail,
  Comment,
  CreateCommentRequest,
  Friend,
  FriendListResponse,
  CreateFriendRequest,
  UpdateFriendRequest,
  Moment,
  CreateMomentRequest,
  ConfigType,
  ConfigResponse,
  AIConfig,
  UploadResponse,
  AuthStatus,
  LoginRequest,
  LoginResponse,
  FeedExportPayload,
  FeedImportResult,
  FeedUnlockResponse,
  FeedAttachment,
} from "@rin/api";


/**
 * HTTP client for making API requests
 */
class HttpClient {
  constructor(private baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options?.headers,
    };

    // Add auth token if available
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (body !== undefined && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        credentials: "include",
      });

      // Handle 204 No Content
      if (response.status === 204) {
        return { data: undefined as T };
      }

      if (!response.ok) {
        let errorValue: unknown;
        const responseClone = response.clone();
        try {
          errorValue = await response.json();
        } catch {
          errorValue = await responseClone.text();
        }
        // Extract error message from various formats
        let errorMessage: string;
        if (typeof errorValue === 'string') {
          errorMessage = errorValue;
        } else if (errorValue && typeof errorValue === 'object') {
          // Handle { error: { message: string } } format
          const err = errorValue as any;
          errorMessage = err.error?.message || err.message || err.error || JSON.stringify(errorValue);
        } else {
          errorMessage = String(errorValue ?? response.statusText);
        }
        return {
          error: {
            status: response.status,
            value: errorMessage,
          },
        };
      }

      // Check if response has content
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return { data: undefined as T };
      }

      // Try to parse JSON, fallback to text
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        return { data };
      }

      const text = await response.text();
      return { data: text as T };
    } catch (error) {
      return {
        error: {
          status: 0,
          value: error instanceof Error ? error.message : "Network error",
        },
      };
    }
  }

  async get<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, body, options);
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>("PATCH", path, body, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  /**
   * 下载二进制内容（附件下载专用）。
   * 普通 request 会把响应当 JSON/文本解析，这里直接把 body 读成 Blob。
   */
  async download(path: string): Promise<ApiResponse<Blob>> {
    const headers: Record<string, string> = {
      Accept: "application/octet-stream",
    };
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "GET",
        headers,
        credentials: "include",
      });

      if (!response.ok) {
        const message = await response.text();
        return {
          error: {
            status: response.status,
            value: message || response.statusText || "Download failed",
          },
        };
      }

      return { data: await response.blob() };
    } catch (error) {
      return {
        error: {
          status: 0,
          value: error instanceof Error ? error.message : "Network error",
        },
      };
    }
  }
}

/**
 * Feed API methods
 */
class FeedAPI {
  constructor(private http: HttpClient) {}

  // GET /api/feed
  async list(params?: { page?: number; limit?: number; type?: 'draft' | 'unlisted' | 'normal' }): Promise<ApiResponse<FeedListResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.type) searchParams.set("type", params.type);
    
    const query = searchParams.toString();
    return this.http.get<FeedListResponse>(`/api/feed${query ? `?${query}` : ""}`);
  }

  // GET /api/feed/timeline
  async timeline(): Promise<ApiResponse<TimelineItem[]>> {
    return this.http.get<TimelineItem[]>("/api/feed/timeline");
  }

  // GET /api/feed/:id
  async get(id: number | string): Promise<ApiResponse<Feed>> {
    return this.http.get<Feed>(`/api/feed/${id}`);
  }

  // POST /api/feed
  async create(body: CreateFeedRequest): Promise<ApiResponse<{ insertedId: number }>> {
    return this.http.post<{ insertedId: number }>("/api/feed", body);
  }

  // POST /api/feed/:id
  async update(id: number, body: UpdateFeedRequest): Promise<ApiResponse<void>> {
    return this.http.post<void>(`/api/feed/${id}`, body);
  }

  // POST /api/feed/:id/unlock
  async unlock(id: number, password: string): Promise<ApiResponse<FeedUnlockResponse>> {
    return this.http.post<FeedUnlockResponse>(`/api/feed/${id}/unlock`, { password });
  }

  // DELETE /api/feed/:id
  async delete(id: number): Promise<ApiResponse<void>> {
    return this.http.delete<void>(`/api/feed/${id}`);
  }

  // GET /api/feed/:id/attachments
  async attachments(id: number, token?: string): Promise<ApiResponse<{
    locked: boolean;
    passwordProtected: boolean;
    attachments?: FeedAttachment[];
    attachmentCount?: number;
  }>> {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    return this.http.get(`/api/feed/${id}/attachments${query}`);
  }

  // POST /api/feed/:id/attachments
  async uploadAttachment(id: number, file: File): Promise<ApiResponse<{ attachment: FeedAttachment }>> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    return this.http.post<{ attachment: FeedAttachment }>(`/api/feed/${id}/attachments`, formData);
  }

  // DELETE /api/feed/:id/attachments/:attachmentId
  async deleteAttachment(id: number, attachmentId: number): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.http.delete<{ deleted: boolean }>(`/api/feed/${id}/attachments/${attachmentId}`);
  }

  // GET /api/feed/:id/attachments/:attachmentId?token=...
  // 作者/管理员不需要 token；游客必须使用解锁文章后得到的短期 token。
  async downloadAttachment(id: number, attachmentId: number, token?: string): Promise<ApiResponse<Blob>> {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    return this.http.download(`/api/feed/${id}/attachments/${attachmentId}${query}`);
  }

  // GET /api/feed/adjacent/:id
  async adjacent(id: number | string): Promise<ApiResponse<AdjacentFeedResponse>> {
    return this.http.get<AdjacentFeedResponse>(`/api/feed/adjacent/${id}`);
  }

  // POST /api/feed/top/:id
  async setTop(id: number, top: number): Promise<ApiResponse<void>> {
    return this.http.post<void>(`/api/feed/top/${id}`, { top });
  }

  // POST /api/feed/sort/:id
  async setSort(id: number, sortOrder: number): Promise<ApiResponse<void>> {
    return this.http.post<void>(`/api/feed/sort/${id}`, { sortOrder });
  }

  // GET /api/feed/export
  async exportAll(): Promise<ApiResponse<FeedExportPayload>> {
    return this.http.get<FeedExportPayload>("/api/feed/export");
  }

  // POST /api/feed/import
  async importAll(file: File): Promise<ApiResponse<FeedImportResult>> {
    const formData = new FormData();
    formData.append("data", file);
    return this.http.post<FeedImportResult>("/api/feed/import", formData);
  }
}

/**
 * Tag API methods
 */
class TagAPI {
  constructor(private http: HttpClient) {}

  // GET /api/tag
  async list(): Promise<ApiResponse<Tag[]>> {
    return this.http.get<Tag[]>("/api/tag");
  }

  // GET /api/tag/:name
  async get(name: string): Promise<ApiResponse<TagDetail>> {
    return this.http.get<TagDetail>(`/api/tag/${encodeURIComponent(name)}`);
  }
}

/**
 * Comment API methods
 */
class CommentAPI {
  constructor(private http: HttpClient) {}

  // GET /api/comment/:feed
  async list(feedId: number): Promise<ApiResponse<Comment[]>> {
    return this.http.get<Comment[]>(`/api/comment/${feedId}`);
  }

  // POST /api/comment/:feed
  async create(feedId: number, body: CreateCommentRequest): Promise<ApiResponse<Comment>> {
    return this.http.post<Comment>(`/api/comment/${feedId}`, body);
  }

  // DELETE /api/comment/:id
  async delete(id: number): Promise<ApiResponse<void>> {
    return this.http.delete<void>(`/api/comment/${id}`);
  }
}

/**
 * User API methods
 */
class UserAPI {
  constructor(private http: HttpClient) {}

  // GET /api/user/profile
  async profile(): Promise<ApiResponse<UserProfile>> {
    return this.http.get<UserProfile>("/api/user/profile");
  }

  // PUT /api/user/profile
  async updateProfile(body: UpdateProfileRequest): Promise<ApiResponse<UpdateProfileResponse>> {
    return this.http.put<UpdateProfileResponse>("/api/user/profile", body);
  }

  // POST /api/user/email/code
  async sendEmailCode(email: string): Promise<ApiResponse<RegisterCodeResponse>> {
    return this.http.post<RegisterCodeResponse>("/api/user/email/code", { email });
  }

  // GET /api/user/admin/list
  async adminList(params?: { page?: number; limit?: number; search?: string }): Promise<ApiResponse<AdminUserListResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.search?.trim()) searchParams.set("search", params.search.trim());

    const query = searchParams.toString();
    return this.http.get<AdminUserListResponse>(`/api/user/admin/list${query ? `?${query}` : ""}`);
  }

  // PUT /api/user/admin/:id
  async adminUpdate(id: number, body: AdminUpdateUserRequest): Promise<ApiResponse<AdminUpdateUserResponse>> {
    return this.http.put<AdminUpdateUserResponse>(`/api/user/admin/${id}`, body);
  }

  // POST /api/user/logout
  async logout(): Promise<ApiResponse<void>> {
    return this.http.post<void>("/api/user/logout");
  }

  // GET /api/user/github
  githubAuth(): string {
    return `${endpoint}/api/user/github`;
  }
}

/**
 * Friend API methods
 */
class FriendAPI {
  constructor(private http: HttpClient) {}

  // GET /api/friend
  async list(): Promise<ApiResponse<FriendListResponse>> {
    return this.http.get<FriendListResponse>("/api/friend");
  }

  // POST /api/friend
  async create(body: CreateFriendRequest): Promise<ApiResponse<Friend>> {
    return this.http.post<Friend>("/api/friend", body);
  }

  // PUT /api/friend/:id
  async update(id: number, body: UpdateFriendRequest): Promise<ApiResponse<Friend>> {
    return this.http.put<Friend>(`/api/friend/${id}`, body);
  }

  // DELETE /api/friend/:id
  async delete(id: number): Promise<ApiResponse<void>> {
    return this.http.delete<void>(`/api/friend/${id}`);
  }
}

/**
 * Moments API methods
 */
class MomentsAPI {
  constructor(private http: HttpClient) {}

  // GET /api/moments
  async list(params?: { page?: number; limit?: number }): Promise<ApiResponse<{ data: Moment[]; hasNext: boolean }>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    
    const query = searchParams.toString();
    return this.http.get<{ data: Moment[]; hasNext: boolean }>(`/api/moments${query ? `?${query}` : ""}`);
  }

  // POST /api/moments
  async create(body: CreateMomentRequest): Promise<ApiResponse<Moment>> {
    return this.http.post<Moment>("/api/moments", body);
  }

  // POST /api/moments/:id
  async update(id: number, body: CreateMomentRequest): Promise<ApiResponse<Moment>> {
    return this.http.post<Moment>(`/api/moments/${id}`, body);
  }

  // DELETE /api/moments/:id
  async delete(id: number): Promise<ApiResponse<void>> {
    return this.http.delete<void>(`/api/moments/${id}`);
  }
}

/**
 * Config API methods
 */
class ConfigAPI {
  constructor(private http: HttpClient) {}

  // GET /api/config
  async getAll(): Promise<ApiResponse<SettingsConfigResponse>> {
    return this.http.get<SettingsConfigResponse>("/api/config");
  }

  // GET /api/config/:type
  async get(type: ConfigType): Promise<ApiResponse<ConfigResponse>> {
    return this.http.get<ConfigResponse>(`/api/config/${type}`);
  }

  // POST /api/config
  async updateAll(body: SettingsConfigResponse): Promise<ApiResponse<SettingsConfigResponse>> {
    return this.http.post<SettingsConfigResponse>("/api/config", body);
  }

  // POST /api/config/:type
  async update(type: ConfigType, body: Record<string, unknown>): Promise<ApiResponse<void>> {
    return this.http.post<void>(`/api/config/${type}`, body);
  }

  // DELETE /api/config/cache
  async clearCache(): Promise<ApiResponse<void>> {
    return this.http.delete<void>("/api/config/cache");
  }

  // GET /api/config/health
  async getHealth(): Promise<ApiResponse<ConfigHealthResponse>> {
    return this.http.get<ConfigHealthResponse>("/api/config/health");
  }

  // GET /api/config/queue-status
  async getQueueStatus(): Promise<ApiResponse<QueueStatusResponse>> {
    return this.http.get<QueueStatusResponse>("/api/config/queue-status");
  }

  async getCompatTasks(): Promise<ApiResponse<CompatTasksResponse>> {
    return this.http.get<CompatTasksResponse>("/api/config/compat-tasks");
  }

  async runCompatAISummary(force = false): Promise<ApiResponse<CompatAISummaryActionResponse>> {
    return this.http.post<CompatAISummaryActionResponse>("/api/config/compat-tasks/ai-summary", { force });
  }

  async getCompatBlurhashCandidates(): Promise<ApiResponse<CompatBlurhashCandidatesResponse>> {
    return this.http.get<CompatBlurhashCandidatesResponse>("/api/config/compat-tasks/blurhash");
  }

  async applyCompatBlurhash(feedId: number, content: string): Promise<ApiResponse<CompatBlurhashApplyResponse>> {
    return this.http.post<CompatBlurhashApplyResponse>(`/api/config/compat-tasks/blurhash/${feedId}`, { content });
  }

  async retryQueueTask(feedId: number): Promise<ApiResponse<QueueTaskActionResponse>> {
    return this.http.post<QueueTaskActionResponse>(`/api/config/queue-status/${feedId}/retry`);
  }

  async deleteQueueTask(feedId: number): Promise<ApiResponse<QueueTaskActionResponse>> {
    return this.http.delete<QueueTaskActionResponse>(`/api/config/queue-status/${feedId}`);
  }

  // POST /api/config/test-ai - Test AI model configuration
  async testAI(body: {
    provider?: string;
    model?: string;
    api_url?: string;
    api_key?: string;
    testPrompt?: string;
  }): Promise<ApiResponse<{ success: boolean; response?: string; error?: string; details?: string; provider?: string; model?: string }>> {
    return this.http.post<any>("/api/config/test-ai", body);
  }

  async testWebhook(body: {
    webhook_url?: string;
    "webhook.method"?: string;
    "webhook.content_type"?: string;
    "webhook.headers"?: string;
    "webhook.body_template"?: string;
    test_message?: string;
  }): Promise<ApiResponse<{ success: boolean; error?: string; details?: string }>> {
    return this.http.post("/api/config/test-webhook", body);
  }

  async testMail(body: {
    "mail.api_url"?: string;
    "mail.email"?: string;
    "mail.password"?: string;
    "mail.account_id"?: string;
    "mail.from_name"?: string;
    "mail.to"?: string;
  }): Promise<ApiResponse<{ success: boolean; error?: string; details?: string }>> {
    return this.http.post("/api/config/test-mail", body);
  }
}

/**
 * AI Config API methods (deprecated, use ConfigAPI instead)
 * @deprecated AI config is now part of server config. Use client.config.get('server') and client.config.update('server', {...}) instead.
 */
class AIConfigAPI {
  constructor(private http: HttpClient) {}

  // GET /api/ai-config
  /** @deprecated Use client.config.get('server') instead */
  async get(): Promise<ApiResponse<AIConfig>> {
    return this.http.get<AIConfig>("/api/ai-config");
  }

  // POST /api/ai-config
  /** @deprecated Use client.config.update('server', {...}) instead */
  async update(body: Partial<AIConfig>): Promise<ApiResponse<void>> {
    return this.http.post<void>("/api/ai-config", body);
  }
}

/**
 * Storage API methods
 */
class StorageAPI {
  constructor(private http: HttpClient) {}

  // POST /api/storage
  async upload(file: File, key?: string): Promise<ApiResponse<UploadResponse>> {
    const formData = new FormData();
    formData.append("file", file);
    if (key) formData.append("key", key);
    
    return this.http.post<UploadResponse>("/api/storage", formData);
  }
}

/**
 * Search API methods
 */
class SearchAPI {
  constructor(private http: HttpClient) {}

  // GET /api/search/:keyword
  async search(keyword: string, params?: { page?: number; limit?: number }): Promise<ApiResponse<FeedListResponse>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", params.page.toString());
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    const query = searchParams.toString();
    return this.http.get<FeedListResponse>(`/api/search/${encodeURIComponent(keyword)}${query ? `?${query}` : ""}`);
  }
}

/**
 * Auth API methods
 */
class AuthAPI {
  constructor(private http: HttpClient) {}

  // GET /api/auth/status
  async status(): Promise<ApiResponse<AuthStatus>> {
    return this.http.get<AuthStatus>("/api/auth/status");
  }

  // POST /api/auth/login
  async login(body: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return this.http.post<LoginResponse>("/api/auth/login", body);
  }

  // POST /api/auth/register/code
  async sendRegisterCode(body: RegisterCodeRequest): Promise<ApiResponse<RegisterCodeResponse>> {
    return this.http.post<RegisterCodeResponse>("/api/auth/register/code", body);
  }

  // POST /api/auth/register
  async register(body: RegisterRequest): Promise<ApiResponse<LoginResponse>> {
    return this.http.post<LoginResponse>("/api/auth/register", body);
  }
}

/**
 * WordPress Import API methods
 */
class WordPressAPI {
  constructor(private http: HttpClient) {}

  // POST /api/wp
  async import(xml: string): Promise<ApiResponse<{ imported: number }>> {
    return this.http.post<{ imported: number }>("/api/wp", { xml });
  }
}

/**
 * RSS API methods - direct fetch for RSS feeds
 */
class RSSAPI {
  constructor(private baseUrl: string) {}

  // GET /rss.xml
  async getRSS(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/rss.xml`);
    return response.text();
  }

  // GET /atom.xml
  async getAtom(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/atom.xml`);
    return response.text();
  }

  // GET /rss.json
  async getJSON(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/rss.json`);
    return response.json();
  }
}

// ============================================================================
// Main API Client Class
// ============================================================================

export class ApiClient {
  private http: HttpClient;
  feed: FeedAPI;
  tag: TagAPI;
  comment: CommentAPI;
  user: UserAPI;
  friend: FriendAPI;
  moments: MomentsAPI;
  config: ConfigAPI;
  aiConfig: AIConfigAPI;
  storage: StorageAPI;
  search: SearchAPI;
  auth: AuthAPI;
  wp: WordPressAPI;
  rss: RSSAPI;

  constructor(baseUrl: string) {
    this.http = new HttpClient(baseUrl);
    this.feed = new FeedAPI(this.http);
    this.tag = new TagAPI(this.http);
    this.comment = new CommentAPI(this.http);
    this.user = new UserAPI(this.http);
    this.friend = new FriendAPI(this.http);
    this.moments = new MomentsAPI(this.http);
    this.config = new ConfigAPI(this.http);
    this.aiConfig = new AIConfigAPI(this.http);
    this.storage = new StorageAPI(this.http);
    this.search = new SearchAPI(this.http);
    this.auth = new AuthAPI(this.http);
    this.wp = new WordPressAPI(this.http);
    this.rss = new RSSAPI(baseUrl);
  }
}

// ============================================================================
// Factory Function (Eden-compatible interface)
// ============================================================================

export function createClient(baseUrl: string): ApiClient {
  return new ApiClient(baseUrl);
}

// Default export
export default ApiClient;
