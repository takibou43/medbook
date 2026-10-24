import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deleteMany: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: { refreshToken: { deleteMany: h.deleteMany } } }));
import { purgeStaleRefreshTokens, REVOKED_TOKEN_RETENTION_MS } from "../src/lib/tokens";

describe("refresh token purge", () => {
  it("removes only expired tokens and tokens revoked more than two days ago", async () => {
    h.deleteMany.mockResolvedValue({ count: 7 });
    const now = new Date("2026-10-24T12:00:00Z");
    expect(await purgeStaleRefreshTokens(now)).toBe(7);
    expect(h.deleteMany).toHaveBeenCalledWith({
      where: { OR: [
        { expiresAt: { lt: now } },
        { revoked: true, createdAt: { lt: new Date(now.getTime() - REVOKED_TOKEN_RETENTION_MS) } },
      ] },
    });
  });
});
