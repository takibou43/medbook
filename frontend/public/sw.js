// ===== مادبوك — Service Worker (بدون أي مكتبة خارجية) =====
//
// المبادئ التي بُني عليها هذا الملف:
//  1) صفحات التطبيق (HTML) دائمًا من الشبكة أولًا، فلا يبقى أحد على نسخة قديمة بعد نشر جديد.
//  2) ملفات البناء داخل /assets/ أسماؤها تحمل بصمة المحتوى (hash) فهي ثابتة لا تتغيّر أبدًا،
//     لذلك تخزينها "الكاش أولًا" آمن ويجعل فتح التطبيق شبه فوري، وأي نشر جديد يولّد أسماء
//     جديدة تُجلب من الشبكة تلقائيًا.
//  3) لا يُخزَّن إطلاقًا أي رد يحمل بيانات (مرضى، مواعيد، جلسات). طلبات الخادم لا تُعترض أصلًا.
//  4) أسماء الكاش مرتبطة بالإصدار، وكل كاش لا ينتمي للإصدار الحالي يُحذف عند التفعيل.
//
// عند أي تغيير في بنية هذا الملف: ارفع رقم VERSION ليُنظَّف الكاش القديم.

const VERSION = "v2";
const SHELL_CACHE = "medbook-shell-" + VERSION;
const ASSET_CACHE = "medbook-assets-" + VERSION;
const KEEP = [SHELL_CACHE, ASSET_CACHE];

const OFFLINE_URL = "/offline.html";

// أصول صغيرة ثابتة نحتاجها حتى بلا اتصال (صفحة الانقطاع وشعارها).
const PRECACHE = [OFFLINE_URL, "/logo.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // كل ملف على حدة: فشل أحدها (مثلًا لم يُنشر بعد) لا يُفشل التثبيت كله.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

// التفعيل: حذف كل كاش من إصدار سابق ثم السيطرة على الصفحات المفتوحة فورًا.
// skipWaiting + clients.claim آمنان هنا تحديدًا لأن الـHTML لا يُخزَّن أبدًا وملفات /assets/
// ثابتة بأسمائها، فلا يمكن أن يُخلَط كود جديد مع كود قديم.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => KEEP.indexOf(k) === -1).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// تتيح للصفحة طلب تفعيل النسخة المنتظرة فورًا عند الحاجة.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// أصول عامة ثابتة (أيقونات، شعار، manifest، خطوط محلية) — لا تحمل أي بيانات مستخدم.
const STATIC_RE = /\.(?:png|svg|ico|webmanifest|woff2?)$/i;

async function offlineFallback() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return new Response(
    "<!doctype html><meta charset=utf-8><h1 dir=rtl>لا يوجد اتصال بالإنترنت.</h1>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // basic = رد من نفس النطاق وغير معتم؛ لا نخزّن أخطاء ولا ردودًا جزئية (206).
  if (res && res.ok && res.type === "basic") cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === "basic") cache.put(request, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // (أ) كل ما هو خارج نطاق الموقع يمرّ كما هو دون أي تدخّل: خادم API، خطوط جوجل...
  if (url.origin !== self.location.origin) return;

  // (ب) حاجز إضافي صريح: أي مسار يشبه واجهة الخادم لا يُعترض ولا يُخزَّن إطلاقًا.
  if (url.pathname.indexOf("/api/") === 0) return;

  // (ج) التنقّل بين الصفحات (ومنها رابط QR ‎/?doctor=ID‎): الشبكة أولًا دائمًا.
  //     لا نخزّن الـHTML أبدًا، فلا يمكن أن يُعرض إصدار قديم من التطبيق بعد النشر.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlineFallback()));
    return;
  }

  // (د) ملفات البناء ذات البصمة: الكاش أولًا (فتح شبه فوري، وصفر خطر تقادُم).
  if (url.pathname.indexOf("/assets/") === 0) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // (هـ) الأصول العامة الثابتة: من الكاش فورًا مع تحديث صامت بالخلفية.
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // (و) أي شيء آخر: لا اعتراض ولا تخزين — يمرّ إلى الشبكة كالمعتاد.
});
