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

const VERSION = "v4";
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

// طلب فتح صفحة: إن فشل على مستوى الشبكة (تقلّب لحظي في شبكة الهاتف/DNS/إعادة اتصال) نعيد المحاولة مرة
// واحدة بعد لحظة قبل الحكم بالانقطاع وعرض صفحة offline. ردود الخادم (حتى 429 و5xx) لا ترمي استثناءً
// أصلًا فتُعرض كما هي — أي أن أعطال الـAPI لا تصل إلى هذا المسار إطلاقًا.
async function navigateWithRetry(request) {
  try {
    return await fetch(request);
  } catch (e) {
    await new Promise(function (resolve) { setTimeout(resolve, 1200); });
    try {
      return await fetch(request);
    } catch (e2) {
      return offlineFallback();
    }
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // basic = رد من نفس النطاق وغير معتم؛ لا نخزّن أخطاء ولا ردودًا جزئية (206).
  if (res && res.ok && res.type === "basic") {
    cache.put(request, res.clone()).then(() => trimCache(cache, MAX_ASSETS)).catch(() => undefined);
  }
  return res;
}

// كل نشر يضيف ملفات جديدة بأسماء جديدة داخل نفس الكاش؛ نُبقي الأحدث فقط حتى لا يتضخّم مع الزمن.
// (keys() مرتَّبة بحسب وقت الإضافة، فالأقدم أولًا.)
const MAX_ASSETS = 40;
async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
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
    event.respondWith(navigateWithRetry(request));
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

// ===== إشعارات Push لحساب المريض (تذكير قبل الموعد بساعة وقبل 5 دقائق) =====
// أُضيفت إلى نفس الـService Worker (لا SW ثانٍ)، ولا تلمس منطق الكاش أو offline أعلاه إطلاقًا.
// الحمولة JSON فيها title وbody وurl وtag فقط — بلا أي معلومة طبية.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  // إشعار موعد انتهى يومه (وصل متأخرًا رغم TTL، أو ساعة الجهاز متقدّمة): لا نعرضه، ونكتفي بإغلاق المنتهي.
  if (mbIsExpired(data, Date.now())) {
    event.waitUntil(mbCloseExpiredNotifications());
    return;
  }

  const title = data.title || "مادبوك";
  const options = {
    body: data.body || "لديك تحديث بخصوص موعدك.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    dir: "rtl",
    lang: "ar",
    // وسم الموعد (appt-<id>): أي إشعار جديد لنفس الموعد يستبدل السابق على الشاشة بدل أن يتراكم.
    tag: data.tag || "medbook-patient",
    renotify: true,
    data: {
      url: data.url || "/account",
      appointmentId: data.appointmentId || null,
      appointmentDate: data.appointmentDate || null,
      expiresAt: data.expiresAt || null,
    },
  };

  event.waitUntil(mbCloseExpiredNotifications().then(() => self.registration.showNotification(title, options)));
});

// الضغط على الإشعار: يفتح صفحة «حسابي» (والموعد المعني) في نافذة الموقع المفتوحة إن وُجدت، وإلا نافذة جديدة.
// نقبل مسارات داخلية فقط (تبدأ بـ"/") حتى لا يفتح الإشعار أي موقع خارجي.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // إشعار موعد منتهٍ ضُغط عليه قبل أن يُغلق: نفتح «حسابي» بدل صفحة الموعد المنتهي.
  const expired = mbIsExpired(event.notification.data, Date.now());
  const raw = (!expired && event.notification.data && event.notification.data.url) || "/account";
  const target = typeof raw === "string" && raw.charAt(0) === "/" && raw.charAt(1) !== "/" ? raw : "/account";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && new URL(client.url).origin === self.location.origin && "focus" in client) {
          if ("navigate" in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// ===== انتهاء إشعارات الموعد بانتهاء يوم الموعد =====
// كل إشعار موعد يحمل في data: appointmentId و expiresAt (نهاية يوم الموعد بتوقيت الجزائر، ISO).
// لا يستطيع الخادم حذف إشعار ظهر فعلًا على الهاتف؛ الممكن فقط أن يُغلقه الـService Worker (أو الصفحة)
// بـ Notification.close() حين يعمل: عند وصول أي Push جديد، وعند تفعيل الـSW، وعند فتح التطبيق
// (register-sw.js). وسم الموعد (appt-<id>) يجعل إشعار الموعد الجديد يستبدل القديم بدل أن يتراكم.
function mbIsExpired(data, now) {
  if (!data || !data.expiresAt) return false;
  var t = Date.parse(data.expiresAt);
  return !isNaN(t) && t <= now;
}

function mbCloseExpiredNotifications() {
  if (!self.registration || typeof self.registration.getNotifications !== "function") return Promise.resolve(0);
  var now = Date.now();
  return self.registration
    .getNotifications()
    .then(function (list) {
      var closed = 0;
      list.forEach(function (n) {
        if (mbIsExpired(n.data, now)) {
          n.close();
          closed++;
        }
      });
      return closed;
    })
    .catch(function () {
      return 0;
    });
}

self.addEventListener("activate", function (event) {
  event.waitUntil(mbCloseExpiredNotifications());
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "MB_CLOSE_EXPIRED_NOTIFICATIONS") event.waitUntil(mbCloseExpiredNotifications());
});
