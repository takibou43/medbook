// Service worker خفيف جدًا: هدفه جعل الموقع قابلًا للتثبيت على الهاتف وإظهار صفحة واضحة
// عند انقطاع الإنترنت فقط. لا نخزّن ملفات البناء مسبقًا عمدًا حتى لا يعلق المستخدم على
// نسخة قديمة بعد كل نشر جديد، ولا نعترض أبدًا طلبات الخادم (API).
const CACHE = "medbook-shell-v1";
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

  // طلبات خارج نطاق الموقع (الخادم، الخطوط...) تمرّ كما هي دون أي تدخّل.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // التنقل بين الصفحات: الشبكة أولًا دائمًا، وصفحة "لا يوجد اتصال" عند الفشل.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
