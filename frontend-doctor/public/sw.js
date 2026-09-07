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

// ---- إشعارات المتصفح (Web Push) ----

// الخادم يرسل JSON فيه title وbody، ونصّ محايد بلا اسم المريض حتى لا تظهر بيانات
// مرضى على شاشة قفل قد يراها من بجانب الطبيب. إن وصل الإشعار فارغًا أو تالفًا نعرض نصًا افتراضيًا.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || "MedBook";
  const options = {
    body: data.body || "افتح اللوحة لعرض التفاصيل.",
    icon: "/logo.svg",
    badge: "/logo.svg",
    dir: "rtl",
    lang: "ar",
    tag: data.tag || "medbook",
    renotify: true,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// الضغط على الإشعار: نعيد استعمال نافذة مفتوحة للوحة إن وجدت بدل فتح نافذة جديدة في كل مرة.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
