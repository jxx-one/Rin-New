import { describe, expect, test } from "bun:test";
import {
  createFeedPasswordHash,
  hasFeedPassword,
  verifyFeedPassword,
} from "../feed-password";

describe("feed password hashing", () => {
  test("creates a salted hash that does not contain the plain password", async () => {
    const hash = await createFeedPasswordHash("open-sesame");

    expect(hash).toMatch(/^v1:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(hash).not.toContain("open-sesame");
  });

  test("accepts the correct password and rejects a wrong one", async () => {
    const hash = await createFeedPasswordHash("correct horse");

    await expect(verifyFeedPassword("correct horse", hash)).resolves.toBe(true);
    await expect(verifyFeedPassword("wrong horse", hash)).resolves.toBe(false);
  });

  test("uses a different salt for each hash of the same password", async () => {
    const first = await createFeedPasswordHash("same-password");
    const second = await createFeedPasswordHash("same-password");

    expect(first).not.toBe(second);
    await expect(verifyFeedPassword("same-password", first)).resolves.toBe(true);
    await expect(verifyFeedPassword("same-password", second)).resolves.toBe(true);
  });

  test("treats malformed hashes as a failed verification", async () => {
    await expect(verifyFeedPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyFeedPassword("anything", "v1:only-two-parts")).resolves.toBe(false);
  });

  test("allows access when no password hash is stored", async () => {
    await expect(verifyFeedPassword("anything", null)).resolves.toBe(true);
    expect(hasFeedPassword(null)).toBe(false);
    expect(hasFeedPassword("v1:abc:def")).toBe(true);
  });
});
