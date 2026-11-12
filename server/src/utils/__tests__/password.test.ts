import { describe, expect, it } from "bun:test";
import {
    hashPassword,
    isLegacyPasswordHash,
    legacySha256PasswordHash,
    verifyPassword,
} from "../password";

describe("password utils", () => {
    it("creates salted hashes that verify only the original password", async () => {
        const first = await hashPassword("correct horse battery staple");
        const second = await hashPassword("correct horse battery staple");

        expect(first.startsWith("v1:")).toBe(true);
        expect(first).not.toBe(second);
        expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
        expect(await verifyPassword("wrong password", first)).toBe(false);
    });

    it("still accepts legacy unsalted SHA-256 hashes", async () => {
        const legacy = await legacySha256PasswordHash("admin123");

        expect(isLegacyPasswordHash(legacy)).toBe(true);
        expect(await verifyPassword("admin123", legacy)).toBe(true);
        expect(await verifyPassword("admin124", legacy)).toBe(false);
    });

    it("rejects malformed and empty stored hashes", async () => {
        expect(await verifyPassword("anything", null)).toBe(false);
        expect(await verifyPassword("anything", "")).toBe(false);
        expect(await verifyPassword("anything", "v1:not-a-number:aa:bb")).toBe(false);
        expect(await verifyPassword("anything", "plain-text-password")).toBe(false);
    });
});
