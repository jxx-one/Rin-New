import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { PasswordAuthService } from "../auth";
import {
  createMockDB,
  createMockEnv,
  cleanupTestDB,
  TestCacheImpl,
} from "../../../tests/fixtures";
import { hashEmailCode } from "../../utils/email-verification";
import { createTestClient } from "../../../tests/test-api-client";
import type { Database } from "bun:sqlite";
import type { Variables } from "../../core/hono-types";

describe("PasswordAuthService", () => {
  let db: any;
  let sqlite: Database;
  let env: Env;
  let app: Hono<{ Bindings: Env; Variables: Variables }>;
  let api: ReturnType<typeof createTestClient>;
  let clientConfig: TestCacheImpl;
  let serverConfig: TestCacheImpl;

  beforeEach(async () => {
    const mockDB = createMockDB();
    db = mockDB.db;
    sqlite = mockDB.sqlite;
    env = createMockEnv({
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "admin123",
    });

    clientConfig = new TestCacheImpl();
    await clientConfig.set("register.enabled", true);
    serverConfig = new TestCacheImpl();

    // Setup Hono app with mock db
    app = new Hono<{ Bindings: Env; Variables: Variables }>();

    // Add middleware to inject test dependencies
    app.use(async (c: any, next: any) => {
      c.set("db", db);
      c.set("jwt", {
        sign: async (payload: any) => `mock_token_${payload.id}`,
        verify: async (token: string) => {
          const match = token.match(/mock_token_(\d+)/);
          return match ? { id: parseInt(match[1]) } : null;
        },
      });
      c.set("env", env);
      c.set("clientConfig", clientConfig);
      c.set("serverConfig", serverConfig);
      await next();
    });

    // Register service with prefix
    app.route('/auth', PasswordAuthService());

    // Add error handler
    app.onError((err: any, c: any) => {
      if (err.code && err.statusCode) {
        return c.json(
          {
            success: false,
            error: {
              code: err.code,
              message: err.message,
              details: err.details,
            },
          },
          err.statusCode,
        );
      }
      return c.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: err.message || "An unexpected error occurred",
          },
        },
        500,
      );
    });

    api = createTestClient(app, env);
  });

  afterEach(() => {
    cleanupTestDB(sqlite);
  });

  describe("POST /auth/login - Login with credentials", () => {
    it("should login with admin credentials", async () => {
      const result = await api.auth.login({
        username: "admin",
        password: "admin123",
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.success).toBe(true);
      expect(result.data?.token).toBeDefined();
      expect(result.data?.user.username).toBe("admin");
      expect(result.data?.user.permission).toBe(true);
    });

    it("should create admin user on first login", async () => {
      // First login - admin user doesn't exist yet
      const result = await api.auth.login({
        username: "admin",
        password: "admin123",
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.success).toBe(true);
      expect(result.data?.user.id).toBeDefined();

      // Verify admin user was created in database
      const dbResult = sqlite.prepare(`SELECT * FROM users WHERE openid = 'admin'`).all() as any[];
      expect(dbResult.length).toBe(1);
      expect(dbResult[0].username).toBe("admin");
      expect(dbResult[0].permission).toBe(1);
    });

    it("should reject invalid admin password", async () => {
      const result = await api.auth.login({
        username: "admin",
        password: "wrongpassword",
      });

      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(403);
      const errorData = result.error?.value as any;
      expect(errorData.error.message).toBe("Invalid credentials");
    });

    it("should login with regular user credentials", async () => {
      // Create a regular user with password
      sqlite.exec(`
        INSERT INTO users (id, username, avatar, openid, password, permission) 
        VALUES (2, 'regularuser', 'avatar.png', 'user_2', '${await hashPassword('userpass')}', 0)
      `);

      const result = await api.auth.login({
        username: "regularuser",
        password: "userpass",
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.success).toBe(true);
      expect(result.data?.user.username).toBe("regularuser");
      expect(result.data?.user.permission).toBe(false);
    });

    it("should reject non-existent user", async () => {
      const result = await api.auth.login({
        username: "nonexistent",
        password: "somepassword",
      });

      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(403);
      const errorData = result.error?.value as any;
      expect(errorData.error.message).toBe("Invalid credentials");
    });

    it("should require username and password", async () => {
      const result = await api.auth.login({
        username: "",
        password: "",
      });

      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(400);
      const errorData = result.error?.value as any;
      expect(errorData.error.message).toBe("Username and password are required");
    });

    it("should return 400 if admin credentials not configured", async () => {
      const envNoCreds = createMockEnv({
        ADMIN_USERNAME: "",
        ADMIN_PASSWORD: "",
      });

      const honoAppNoCreds = new Hono<{
        Bindings: Env;
        Variables: Variables;
      }>();
      honoAppNoCreds.use(async (c: any, next: any) => {
        c.set("db", db);
        c.set("jwt", {
          sign: async (payload: any) => `mock_token_${payload.id}`,
          verify: async (token: string) => {
            const match = token.match(/mock_token_(\d+)/);
            return match ? { id: parseInt(match[1]) } : null;
          },
        });
        c.set("env", envNoCreds);
        await next();
      });

      honoAppNoCreds.route('/auth', PasswordAuthService());

      // Add error handler
      honoAppNoCreds.onError((err: any, c: any) => {
        if (err.code && err.statusCode) {
          return c.json(
            {
              success: false,
              error: {
                code: err.code,
                message: err.message,
                details: err.details,
              },
            },
            err.statusCode,
          );
        }
        return c.json(
          {
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: err.message || "An unexpected error occurred",
            },
          },
          500,
        );
      });

      const appNoCreds = {
        ...honoAppNoCreds,
        fetch: (request: Request, env: Env) =>
          honoAppNoCreds.fetch(request, { ...env, DB: db }),
      };

      const apiNoCreds = createTestClient(appNoCreds, envNoCreds);

      const result = await apiNoCreds.auth.login({
        username: "admin",
        password: "admin123",
      });

      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(400);
      const errorData = result.error?.value as any;
      expect(errorData.error.message).toBe("Admin credentials not configured");
    });

    it("should reject user without password", async () => {
      // Create a user without password
      sqlite.exec(`
        INSERT INTO users (id, username, avatar, openid, password, permission) 
        VALUES (3, 'nopassworduser', 'avatar.png', 'user_3', NULL, 0)
      `);

      const result = await api.auth.login({
        username: "nopassworduser",
        password: "anypassword",
      });

      expect(result.error).toBeDefined();
      expect(result.error?.status).toBe(403);
      const errorData = result.error?.value as any;
      expect(errorData.error.message).toBe("Invalid credentials");
    });
  });

  describe("POST /auth/register - Email code registration", () => {
    async function seedCode(email: string, code = "123456") {
      const codeHash = await hashEmailCode(env.JWT_SECRET!, email, "register", code);
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      sqlite.prepare(
        "INSERT INTO email_verifications (email, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)",
      ).run(email, "register", codeHash, expiresAt);
      return code;
    }

    it("registers a user, marks email verified, and logs in with the new password", async () => {
      const code = await seedCode("new@example.com");

      const result = await api.auth.register({
        email: "NEW@example.com",
        username: "newuser",
        password: "password123",
        code,
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.success).toBe(true);
      expect(result.data?.user.username).toBe("newuser");
      expect(result.data?.user.email).toBe("new@example.com");
      expect(result.data?.user.permission).toBe(false);

      const saved = sqlite.prepare(
        "SELECT email, email_verified_at, password FROM users WHERE username = ?",
      ).get("newuser") as { email: string; email_verified_at: number | null; password: string };
      expect(saved.email).toBe("new@example.com");
      expect(saved.email_verified_at).not.toBeNull();
      expect(saved.password.startsWith("v1:")).toBe(true);

      const login = await api.auth.login({ username: "newuser", password: "password123" });
      expect(login.error).toBeUndefined();
      expect(login.data?.success).toBe(true);
    });

    it("rejects an invalid verification code without creating a user", async () => {
      await seedCode("bad@example.com", "654321");

      const result = await api.auth.register({
        email: "bad@example.com",
        username: "baduser",
        password: "password123",
        code: "000000",
      });

      expect(result.error?.status).toBe(400);
      const count = sqlite.prepare("SELECT COUNT(*) as count FROM users WHERE username = ?").get("baduser") as { count: number };
      expect(count.count).toBe(0);
    });

    it("rejects the reserved admin username", async () => {
      await seedCode("reserved@example.com");

      const result = await api.auth.register({
        email: "reserved@example.com",
        username: "admin",
        password: "password123",
        code: "123456",
      });

      expect(result.error?.status).toBe(409);
      const count = sqlite.prepare("SELECT COUNT(*) as count FROM users WHERE email = ?").get("reserved@example.com") as { count: number };
      expect(count.count).toBe(0);
    });

    it("rejects duplicate email before consuming the code", async () => {
      await seedCode("duplicate@example.com");
      await api.auth.register({
        email: "duplicate@example.com",
        username: "firstuser",
        password: "password123",
        code: "123456",
      });

      const result = await api.auth.register({
        email: "duplicate@example.com",
        username: "seconduser",
        password: "password123",
        code: "123456",
      });

      expect(result.error?.status).toBe(409);
    });
  });

  describe("POST /auth/register/code - Send email code", () => {
    it("sends a code through Cloud Mail and stores only its hash", async () => {
      await serverConfig.set("mail.enabled", "true");
      await serverConfig.set("mail.email", "sender@example.com");
      await serverConfig.set("mail.password", "secret");
      await serverConfig.set("mail.account_id", "1");
      await serverConfig.set("mail.from_name", "Rin");

      const requests: Array<{ url: string; body: any }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ url, body });
        const payload = url.includes("/api/login")
          ? { code: 200, data: { token: "mail-token" } }
          : { code: 200, data: {} };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      try {
        const result = await api.auth.sendRegisterCode({ email: "NEW@example.com" });
        expect(result.error).toBeUndefined();
        expect(result.data?.success).toBe(true);
        expect(result.data?.expiresIn).toBe(600);
      } finally {
        globalThis.fetch = originalFetch;
      }

      const sendRequest = requests.find((request) => request.url.includes("/api/email/send"));
      expect(sendRequest?.body.receiveEmail).toEqual(["new@example.com"]);

      const row = sqlite.prepare(
        "SELECT email, code_hash FROM email_verifications WHERE purpose = 'register'",
      ).get() as { email: string; code_hash: string } | null;
      expect(row?.email).toBe("new@example.com");
      expect(row?.code_hash).toHaveLength(64);
    });
  });

  describe("GET /auth/status - Check auth availability", () => {
    it("should return github and password status", async () => {
      const result = await api.auth.status();

      expect(result.error).toBeUndefined();
      expect(result.data?.github).toBe(true); // Has GitHub credentials in env
      expect(result.data?.password).toBe(true); // Has admin credentials
    });

    it("should return false when credentials not configured", async () => {
      const envNoCreds = createMockEnv({
        RIN_GITHUB_CLIENT_ID: "",
        RIN_GITHUB_CLIENT_SECRET: "",
        ADMIN_USERNAME: "",
        ADMIN_PASSWORD: "",
      });

      const honoAppNoCreds = new Hono<{
        Bindings: Env;
        Variables: Variables;
      }>();
      honoAppNoCreds.use(async (c: any, next: any) => {
        c.set("db", db);
        c.set("env", envNoCreds);
        await next();
      });
      honoAppNoCreds.route('/auth', PasswordAuthService());

      // Add error handler
      honoAppNoCreds.onError((err: any, c: any) => {
        if (err.code && err.statusCode) {
          return c.json(
            {
              success: false,
              error: {
                code: err.code,
                message: err.message,
                details: err.details,
              },
            },
            err.statusCode,
          );
        }
        return c.json(
          {
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: err.message || "An unexpected error occurred",
            },
          },
          500,
        );
      });

      // Add fetch method for test client compatibility
      const appNoCreds = {
        ...honoAppNoCreds,
        fetch: (request: Request, env: Env) =>
          honoAppNoCreds.fetch(request, { ...env, DB: db }),
      };

      const apiNoCreds = createTestClient(appNoCreds, envNoCreds);

      const result = await apiNoCreds.auth.status();

      expect(result.error).toBeUndefined();
      expect(result.data?.github).toBe(false);
      expect(result.data?.password).toBe(false);
    });
  });
});

// Hash password using SHA-256
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
