#!/usr/bin/env node
// يولّد public/_headers لـ Cloudflare Pages من vercel.json لكل موقع، حتى تبقى ترويسات الأمان
// والتخزين المؤقت متطابقة بين المنصتين أثناء الانتقال. الاستعمال: node scripts/cloudflare-pages-headers.mjs [--check]
// لا حاجة إلى _redirects: Cloudflare Pages يعامل الموقع كتطبيق صفحة واحدة ما دام لا يوجد 404.html.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
let stale = false;

export function toCloudflarePattern(source) {
  if (source === "/(.*)") return "/*";
  return source.replace("(.*)", "*");
}

export function renderHeaders(vercel) {
  const blocks = vercel.headers.map(({ source, headers }) =>
    [toCloudflarePattern(source), ...headers.map(({ key, value }) => `  ${key}: ${value}`)].join("\n"));
  return "# مولَّد من vercel.json بواسطة scripts/cloudflare-pages-headers.mjs — لا تعدّله يدويًا.\n" + blocks.join("\n\n") + "\n";
}

for (const app of ["frontend", "frontend-doctor"]) {
  const vercel = JSON.parse(readFileSync(join(root, app, "vercel.json"), "utf8"));
  if (existsSync(join(root, app, "public", "404.html"))) throw new Error(`${app}: 404.html يعطّل وضع الصفحة الواحدة في Cloudflare Pages`);
  const target = join(root, app, "public", "_headers");
  const next = renderHeaders(vercel);
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current === next) continue;
  if (check) { console.error(`${app}/public/_headers لا يطابق vercel.json`); stale = true; continue; }
  writeFileSync(target, next);
  console.log(`كُتب ${app}/public/_headers`);
}
if (stale) process.exit(1);
