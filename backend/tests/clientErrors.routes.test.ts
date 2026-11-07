import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CATEGORIES, ERROR_CODES, ROUTE_SEGMENTS, CLIENT_ERROR_LIMIT, isGeneralizedRoute, clientErrorSchema } from "../src/modules/clientErrors/clientErrors.routes";
import { env } from "../src/config/env";

// بيانات وهمية حساسة: يجب ألا يصل أي منها إلى السجل مهما كان الحقل الذي وُضعت فيه.
const SENSITIVE = [
  "محمد بن علي", "فاطمة الزهراء", "Ahmed Benali", "Sarah Martin",
  "سكري من النوع الثاني", "hypertension artérielle", "diabète", "Diagnosis: asthma",
  "eyJhbGciOiJIUzI1NiJ9.fake.signature", "sk_live_FAKE1234567890", "AKIAFAKEKEY1234567",
  "0551234567", "patient@example.dz", "cm3x9k2abc0001",
];

async function freshApp() {
  vi.resetModules(); // عدّادات حد المعدل جديدة لكل اختبار
  const { default: routes } = await import("../src/modules/clientErrors/clientErrors.routes");
  const app = express();
  app.use(express.json());
  app.use("/e", routes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? (err.name === "ZodError" ? 400 : 500)).json({ ok: false }));
  return app;
}

const valid = { portal: "patient", kind: "error", category: "TypeError", route: "/clinics/:param", asset: "index-B4kd8sXz.js", line: 12, column: 4 };
let warn: ReturnType<typeof vi.spyOn>;
const logged = () => warn.mock.calls.map((c) => c.join(" ")).join("\n");
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());

describe("client error reports carry allowlisted technical data only", () => {
  it("logs a valid technical report as one line with only the allowed fields", async () => {
    const res = await request(await freshApp()).post("/e").send(valid);
    expect(res.status).toBe(204);
    const line = logged();
    expect(line).toContain("[client-error]");
    expect(JSON.parse(line.replace("[client-error] ", ""))).toEqual(valid);
  });

  it("rejects free text (message, stack, query) and never logs it", async () => {
    const app = await freshApp();
    for (const secret of SENSITIVE) {
      for (const extra of [{ message: secret }, { stack: `Error: ${secret}\n at x` }, { path: `/status/x?name=${secret}` }]) {
        expect(clientErrorSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
        expect([400, 429]).toContain((await request(app).post("/e").send({ ...valid, ...extra })).status); // 429 بعد الحد
      }
    }
    expect(logged()).toBe("");
  });

  it("rejects sensitive values smuggled into allowed fields", async () => {
    const app = await freshApp();
    for (const secret of SENSITIVE) {
      const attempts = [
        { category: secret }, { code: secret }, { route: `/status/${secret}` }, { route: `/${secret}` },
        { route: `/clinics/${encodeURIComponent(secret)}` }, { asset: `${secret}.js` }, { portal: secret },
      ];
      for (const a of attempts) {
        expect(clientErrorSchema.safeParse({ ...valid, ...a }).success).toBe(false);
        expect([400, 429]).toContain((await request(app).post("/e").send({ ...valid, ...a })).status);
      }
    }
    expect(logged()).toBe("");
  });

  it("accepts only routes built from known segments or :param", () => {
    expect(isGeneralizedRoute("/")).toBe(true);
    expect(isGeneralizedRoute("/assistant/accept/:param")).toBe(true);
    expect(isGeneralizedRoute("/clinics/cm3x9k2abc0001")).toBe(false);
    expect(isGeneralizedRoute("/a/b/c/d/e/f/g")).toBe(false);
  });

  it("origin guard is not authentication: foreign browser origins are refused, no-Origin calls are rate limited", async () => {
    const app = await freshApp();
    expect((await request(app).post("/e").set("Origin", "https://evil.example").send(valid)).status).toBe(403);
    expect(env.clientUrls).not.toContain("https://evil.example");
    let last = 0;
    for (let i = 0; i <= CLIENT_ERROR_LIMIT; i += 1) last = (await request(app).post("/e").send(valid)).status;
    expect(last).toBe(429);
  });

  it("server allowlists are identical to both websites' allowlists", () => {
    for (const app of ["frontend", "frontend-doctor"]) {
      const src = readFileSync(join(__dirname, "..", "..", app, "src/lib/clientErrorPayload.ts"), "utf8");
      const list = (name: string) => JSON.parse(src.match(new RegExp(`${name} = (\\[[\\s\\S]*?\\]) as const`))![1].replace(/,\s*\]/, "]"));
      expect(list("ERROR_CATEGORIES")).toEqual([...ERROR_CATEGORIES]);
      expect(list("ERROR_CODES")).toEqual([...ERROR_CODES]);
      expect(list("ROUTE_SEGMENTS")).toEqual([...ROUTE_SEGMENTS]);
    }
  });
});
