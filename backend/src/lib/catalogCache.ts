import { createHash } from "crypto";
import type { Request, Response } from "express";

/**
 * ذاكرة مؤقتة داخل العملية للفهارس العامة (الولايات + البلديات، التخصصات).
 *
 * هذه البيانات نفسها لكل الزوار وتتغيّر نادرًا (من لوحة الإدارة أو عند تسجيل تخصص جديد)، لكنها
 * كانت تُقرأ من قاعدة البيانات وتُرسل كاملة (~200KB للبلديات) مع كل زيارة. الآن:
 *  - تُقرأ من القاعدة مرة واحدة كل TTL أو بعد أي تعديل (invalidateCatalogCache)؛
 *  - تُرسل مع ETag و«no-cache»، فيعيد المتصفح التحقق ويتلقى 304 بلا جسم إن لم يتغيّر شيء؛
 *  - الرد نفسه (JSON) لا يتغيّر حرفًا عمّا كان.
 * خادم واحد فقط (Render)، فالإبطال داخل العملية كافٍ.
 */
interface Entry { body: string; etag: string; expiresAt: number }

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<Entry>>();
let generation = 0;

export function invalidateCatalogCache() {
  generation++;
  entries.clear();
  loading.clear();
}

// اختبارات التكامل تكتب في القاعدة مباشرة ثم تقرأ؛ لا نخزّن مؤقتًا هناك إلا إن طُلب صراحة.
function cacheEnabled() {
  return process.env.NODE_ENV !== "test" || process.env.CATALOG_CACHE_IN_TESTS === "1";
}

async function load(key: string, ttlMs: number, fetch: () => Promise<unknown>): Promise<Entry> {
  const now = Date.now();
  const hit = entries.get(key);
  if (cacheEnabled() && hit && hit.expiresAt > now) return hit;
  const pending = loading.get(key);
  if (cacheEnabled() && pending) return pending;
  const started = generation;
  const promise = (async () => {
    const body = JSON.stringify({ success: true, data: await fetch() });
    const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
    const entry = { body, etag, expiresAt: Date.now() + ttlMs };
    // لا نحفظ نتيجة بدأت قبل إبطال حدث أثناء القراءة.
    if (cacheEnabled() && started === generation) entries.set(key, entry);
    return entry;
  })();
  if (cacheEnabled()) loading.set(key, promise);
  try {
    return await promise;
  } finally {
    if (loading.get(key) === promise) loading.delete(key);
  }
}

export async function sendCatalog(req: Request, res: Response, key: string, ttlMs: number, fetch: () => Promise<unknown>) {
  const entry = await load(key, ttlMs, fetch);
  // يتجاوز no-store العام على /api: بيانات عامة بلا أي معلومة شخصية، ويُعاد التحقق منها في كل مرة.
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("ETag", entry.etag);
  const match = req.headers["if-none-match"];
  if (match && match.split(",").some((tag) => tag.trim() === entry.etag)) {
    res.status(304).end();
    return;
  }
  res.type("application/json").send(entry.body);
}
