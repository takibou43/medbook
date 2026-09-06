// Service worker خفيف جدًا: هدفه جعل لوحة الطبيب قابلة للتثبيت على الهاتف وإظهار صفحة
// واضحة عند انقطاع الإنترنت فقط. لا نخزّن ملفات البناء مسبقًا حتى لا يعلق الطبيب على نسخة
// قديمة بعد كل نشر، ولا نعترض أبدًا طلبات الخادم (API) ولا بيانات الجلسة.
const CACHE = "medbook-doctor-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
