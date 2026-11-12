import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { createMockDB, cleanupTestDB } from "../../../tests/fixtures";
import { emailVerifications } from "../../db/schema";
import {
    consumeEmailVerification,
    createEmailVerification,
    generateEmailCode,
    hashEmailCode,
    isValidEmail,
    normalizeEmail,
    verifyEmailCode,
} from "../email-verification";

const SECRET = "test-secret";

describe("email verification utils", () => {
    let db: any;
    let sqlite: Database;

    beforeEach(() => {
        const mockDB = createMockDB();
        db = mockDB.db;
        sqlite = mockDB.sqlite;
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    it("normalizes and validates addresses", () => {
        expect(normalizeEmail("  USER@Example.COM ")).toBe("user@example.com");
        expect(isValidEmail("user@example.com")).toBe(true);
        expect(isValidEmail("not-an-email")).toBe(false);
        expect(isValidEmail("")).toBe(false);
    });

    it("generates six-digit codes and verifies HMAC hashes", async () => {
        const code = generateEmailCode();
        expect(code).toMatch(/^\d{6}$/);

        const hash = await hashEmailCode(SECRET, "user@example.com", "register", code);
        expect(hash).toHaveLength(64);
        expect(await verifyEmailCode(SECRET, "user@example.com", "register", code, hash)).toBe(true);
        expect(await verifyEmailCode(SECRET, "user@example.com", "register", "000000", hash)).toBe(false);
        expect(await verifyEmailCode(SECRET, "other@example.com", "register", code, hash)).toBe(false);
    });

    it("stores only a hash, enforces resend cooldown and consumes once", async () => {
        const verification = await createEmailVerification(db, "user@example.com", "register", SECRET);

        const saved = await db.query.emailVerifications.findFirst({
            where: eq(emailVerifications.id, verification.id),
        });
        expect(saved.codeHash).toHaveLength(64);
        expect(saved.codeHash).not.toContain(verification.code);
        expect(saved.consumedAt).toBeNull();

        expect(await consumeEmailVerification(
            db,
            "user@example.com",
            "register",
            verification.code,
            SECRET,
        )).toEqual({ ok: true });

        expect(await consumeEmailVerification(
            db,
            "user@example.com",
            "register",
            verification.code,
            SECRET,
        )).toEqual({ ok: false, reason: "missing" });

        let cooldownError: unknown;
        try {
            await createEmailVerification(db, "user@example.com", "register", SECRET);
        } catch (error) {
            cooldownError = error;
        }
        expect(String(cooldownError)).toContain("wait");
    });
});
