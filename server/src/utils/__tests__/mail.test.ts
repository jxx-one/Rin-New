import { afterEach, describe, expect, it } from "bun:test";
import {
  buildMailRequest,
  escapeHtml,
  normalizeCloudMailBaseUrl,
  resolveMailConfig,
  sendEventMail,
  sendMail,
  type MailConfig,
} from "../mail";

function createMailConfig(overrides: Partial<MailConfig> = {}): MailConfig {
  return {
    enabled: true,
    apiUrl: "https://mail.example.com",
    email: "admin@example.com",
    password: "secret",
    accountId: "12",
    fromName: "Rin Blog",
    to: "owner@example.com",
    events: { comment: true, friend: true, feed: true },
    ...overrides,
  };
}

function createConfigReader(values: Record<string, unknown>) {
  return {
    get: async (key: string) => values[key],
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mail utils", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves stored config with Cloud Mail defaults", async () => {
    const config = await resolveMailConfig(createConfigReader({}), {});
    expect(config.enabled).toBe(false);
    expect(config.apiUrl).toBe("https://skymail.ink");
    expect(config.email).toBe("");
    expect(config.accountId).toBe("");
    expect(config.events).toEqual({ comment: true, friend: true, feed: true });
  });

  it("normalizes the Cloud Mail base URL", () => {
    expect(normalizeCloudMailBaseUrl("https://mail.example.com/")).toBe("https://mail.example.com");
    expect(normalizeCloudMailBaseUrl("https://mail.example.com/api/")).toBe("https://mail.example.com");
    expect(normalizeCloudMailBaseUrl("https://mail.example.com")).toBe("https://mail.example.com");
  });

  it("ignores the legacy Resend URL stored by the previous mail integration", async () => {
    const config = await resolveMailConfig(
      createConfigReader({ "mail.api_url": "https://api.resend.com/emails" }),
      {},
    );
    expect(config.apiUrl).toBe("https://skymail.ink");
  });

  it("returns an error when required fields are missing", async () => {
    const missingRecipient = await sendMail(createMailConfig({ to: "" }), { subject: "x", html: "y" });
    expect(missingRecipient.success).toBe(false);
    expect(missingRecipient.error).toBe("Mail recipient is required");

    const missingEmail = await sendMail(createMailConfig({ email: "" }), { subject: "x", html: "y" });
    expect(missingEmail.success).toBe(false);
    expect(missingEmail.error).toBe("Cloud Mail login email is required");

    const missingPassword = await sendMail(createMailConfig({ password: "" }), { subject: "x", html: "y" });
    expect(missingPassword.success).toBe(false);
    expect(missingPassword.error).toBe("Cloud Mail password is required");
  });

  it("builds a Cloud Mail send request with a raw Authorization token", () => {
    const request = buildMailRequest(
      createMailConfig({ to: "a@example.com, b@example.com; c@example.com" }),
      { subject: "新评论", html: "<p>hello <strong>world</strong></p>" },
      "token-without-bearer",
      12,
    );

    expect(request.url).toBe("https://mail.example.com/api/email/send");
    expect(request.headers.Authorization).toBe("token-without-bearer");
    expect(request.headers.Authorization).not.toContain("Bearer");

    const body = JSON.parse(request.body) as any;
    expect(body.accountId).toBe(12);
    expect(body.name).toBe("Rin Blog");
    expect(body.receiveEmail).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
    expect(body.subject).toBe("新评论");
    expect(body.content).toBe("<p>hello <strong>world</strong></p>");
    expect(body.text).toBe("hello world");
    expect(body.sendType).toBe("");
    expect(body.attachments).toEqual([]);
  });

  it("logs in then sends with the configured account id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "admin@example.com",
          password: "secret",
        });
        return jsonResponse({ code: 200, message: "success", data: { token: "cloud-token" } });
      }
      if (url.endsWith("/api/email/send")) {
        return jsonResponse({ code: 200, message: "success", data: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await sendMail(createMailConfig(), { subject: "x", html: "<b>y</b>" });
    expect(result.success).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "https://mail.example.com/api/login",
      "https://mail.example.com/api/email/send",
    ]);

    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("cloud-token");
    const sent = JSON.parse(String(calls[1]?.init?.body)) as any;
    expect(sent.accountId).toBe(12);
  });

  it("resolves the account id from the account list when it is not configured", async () => {
    const calls: string[] = [];
    let sentBody: any;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/login")) {
        return jsonResponse({ code: 200, data: { token: "cloud-token" } });
      }
      if (url.includes("/api/account/list")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("cloud-token");
        return jsonResponse({
          code: 200,
          data: [
            { accountId: 3, email: "other@example.com", name: "Other" },
            { accountId: 7, email: "admin@example.com", name: "Main account" },
          ],
        });
      }
      if (url.endsWith("/api/email/send")) {
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse({ code: 200, data: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await sendMail(createMailConfig({ accountId: "", fromName: "" }), {
      subject: "x",
      html: "y",
    });
    expect(result.success).toBe(true);
    expect(calls).toContain("https://mail.example.com/api/account/list?size=30");
    expect(sentBody.accountId).toBe(7);
    expect(sentBody.name).toBe("Main account");
  });

  it("fails when several accounts exist and none matches the login email", async () => {
    let sendCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/login")) {
        return jsonResponse({ code: 200, data: { token: "cloud-token" } });
      }
      if (url.includes("/api/account/list")) {
        return jsonResponse({
          code: 200,
          data: [
            { accountId: 1, email: "one@example.com" },
            { accountId: 2, email: "two@example.com" },
          ],
        });
      }
      if (url.endsWith("/api/email/send")) {
        sendCalls++;
        return jsonResponse({ code: 200, data: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await sendMail(createMailConfig({ accountId: "" }), { subject: "x", html: "y" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("account id could not be resolved");
    expect(sendCalls).toBe(0);
  });

  it("reports login failures", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ code: 401, message: "invalid password" }, 401)) as typeof fetch;

    const result = await sendMail(createMailConfig(), { subject: "x", html: "y" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid password");
    expect(result.status).toBe(401);
  });

  it("treats a non-200 business code as a send failure", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/login")) {
        return jsonResponse({ code: 200, data: { token: "cloud-token" } });
      }
      return jsonResponse({ code: 400, message: "receive email is required" }, 200);
    }) as typeof fetch;

    const result = await sendMail(createMailConfig(), { subject: "x", html: "y" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("receive email is required");
    expect(result.status).toBe(200);
  });

  it("skips event mail when disabled or the event is off", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ code: 200, data: {} });
    }) as typeof fetch;

    const disabled = await sendEventMail(createConfigReader({ "mail.enabled": "false" }), "comment", {
      subject: "x",
      html: "y",
    });
    expect(disabled.skipped).toBe(true);

    const eventOff = await sendEventMail(
      createConfigReader({
        "mail.enabled": "true",
        "mail.email": "admin@example.com",
        "mail.password": "secret",
        "mail.to": "owner@example.com",
        "mail.notify_comment": "false",
      }),
      "comment",
      { subject: "x", html: "y" },
    );
    expect(eventOff.skipped).toBe(true);
    expect(calls).toBe(0);
  });

  it("escapes HTML in notification content", () => {
    expect(escapeHtml('<script>"x"</script>')).toBe("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  });
});
