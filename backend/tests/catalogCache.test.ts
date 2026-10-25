import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { invalidateCatalogCache, sendCatalog } from "../src/lib/catalogCache";

describe("catalog cache", () => {
  const fetch = vi.fn();
  const app = express();
  app.get("/catalog", async (req, res) => sendCatalog(req, res, "test", 60_000, fetch));

  beforeAll(() => { process.env.CATALOG_CACHE_IN_TESTS = "1"; });
  afterAll(() => { delete process.env.CATALOG_CACHE_IN_TESTS; });
  beforeEach(() => { invalidateCatalogCache(); fetch.mockReset(); });

  it("keeps the exact response shape and reads the database once", async () => {
    fetch.mockResolvedValue([{ id: "w1", nameAr: "ميلة" }]);
    const first = await request(app).get("/catalog");
    const second = await request(app).get("/catalog");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ success: true, data: [{ id: "w1", nameAr: "ميلة" }] });
    expect(second.body).toEqual(first.body);
    expect(first.headers["cache-control"]).toBe("no-cache");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("answers 304 without a body when the browser copy is current", async () => {
    fetch.mockResolvedValue([1, 2, 3]);
    const first = await request(app).get("/catalog");
    const again = await request(app).get("/catalog").set("If-None-Match", first.headers.etag);
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
  });

  it("serves fresh data right after an invalidation", async () => {
    fetch.mockResolvedValueOnce(["old"]).mockResolvedValueOnce(["new"]);
    const before = await request(app).get("/catalog");
    invalidateCatalogCache();
    const after = await request(app).get("/catalog").set("If-None-Match", before.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual(["new"]);
  });

  it("shares one database read between concurrent first requests", async () => {
    let release!: (v: unknown) => void;
    fetch.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = Promise.all([request(app).get("/catalog"), request(app).get("/catalog"), request(app).get("/catalog")]);
    await new Promise(r => setTimeout(r, 20));
    release(["x"]);
    const responses = await pending;
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache inside ordinary integration tests", async () => {
    delete process.env.CATALOG_CACHE_IN_TESTS;
    fetch.mockResolvedValueOnce(["a"]).mockResolvedValueOnce(["b"]);
    expect((await request(app).get("/catalog")).body.data).toEqual(["a"]);
    expect((await request(app).get("/catalog")).body.data).toEqual(["b"]);
    process.env.CATALOG_CACHE_IN_TESTS = "1";
  });
});
