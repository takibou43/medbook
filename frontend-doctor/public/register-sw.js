// تسجيل الـservice worker + التحديث التلقائي الآمن (بدون مكتبات).
// ملف مستقل خارج /assets/ (لا يُخزَّن في الكاش أبدًا، ورأسه must-revalidate في vercel.json).
//
// لماذا لا يكفي تحديث الـservice worker وحده؟
//  الـSW يتحدّث فقط إذا تغيّرت بايتات sw.js نفسه. أما نشر واجهة جديدة (ملفات /assets/ بأسماء جديدة)
//  دون تغيير sw.js فلا يكتشفه المتصفح، فيبقى تطبيق PWA المفتوح/المُستأنف من الخلفية على الكود القديم
//  أيامًا. لذلك نقارن هنا بصمة ملف البناء الرئيسي في index.html الحالي على الخادم بما هو محمَّل فعلًا.
//
// متى يُطبَّق التحديث؟ فقط في "نقطة آمنة" — لا أثناء كتابة في نموذج، ولا طلب API جارٍ، ولا أثناء
// خطوات الحجز (الصفحة تضع data-mb-busy على <html>):
//   1) عند الانتقال إلى صفحة أخرى داخل التطبيق (المستخدم يغادر شاشته أصلًا).
//   2) أو عند ذهاب التطبيق إلى الخلفية (hidden) بشرط أن تتحقق شروط الأمان.
(function () {
  if (!("serviceWorker" in navigator)) return;

  var rawFetch = window.fetch ? window.fetch.bind(window) : null;

  // ---- عدّاد الطلبات "الكاتبة" الجارية (POST/PUT/PATCH/DELETE عبر fetch وXHR/axios) ----
  // طلبات القراءة (GET) لا تُحسب: إعادة التحميل تقطعها لكن تُعاد تلقائيًا ولا تغيّر شيئًا في الخادم،
  // ولو حُسبت لما وجدنا نقطة آمنة أبدًا لأن كل صفحة جديدة تبدأ بطلبات قراءة فور فتحها.
  var inflight = 0;
  function done() { inflight = Math.max(0, inflight - 1); }
  function isWrite(method) {
    var m = String(method || "GET").toUpperCase();
    return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  }
  try {
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var method = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
        var counted = isWrite(method);
        if (counted) inflight++;
        var p;
        try { p = origFetch.apply(this, arguments); } catch (e) { if (counted) done(); throw e; }
        if (counted) p.then(done, done);
        return p;
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method) {
      this.__mbWrite = isWrite(method);
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (!this.__mbWrite) return origSend.apply(this, arguments);
      inflight++;
      var finished = false;
      var fin = function () { if (!finished) { finished = true; done(); } };
      this.addEventListener("loadend", fin);
      try { return origSend.apply(this, arguments); } catch (e) { fin(); throw e; }
    };
  } catch (e) {}

  // ---- هل المستخدم يكتب في نموذج؟ (أي إدخال منذ آخر انتقال بين الصفحات) ----
  var dirty = false;
  document.addEventListener("input", function () { dirty = true; }, true);

  var HIDDEN_LONG_MS = 6 * 60 * 60 * 1000; // مخفي 6 ساعات فأكثر = تُرك غالبًا؛ لا نُبقيه على نسخة قديمة
  var hiddenAt = 0;
  var updateReady = false;
  var reloading = false;
  var targetBuild = "";

  function busyPage() {
    return document.documentElement.getAttribute("data-mb-busy") === "1";
  }
  function isSafe(reason) {
    if (inflight > 0) return false;
    if (reason === "hidden") {
      var longAway = hiddenAt && Date.now() - hiddenAt >= HIDDEN_LONG_MS;
      if (!longAway && (dirty || busyPage())) return false;
    } else if (busyPage()) {
      return false;
    }
    return true;
  }

  function doReload() {
    if (reloading) return;
    // حاجز حلقات: لا أكثر من إعادة تحميل تلقائية واحدة لكل بصمة هدف خلال 10 دقائق.
    try {
      var last = JSON.parse(sessionStorage.getItem("mb-auto-reload") || "null");
      if (last && last.build === targetBuild && Date.now() - last.at < 10 * 60 * 1000) return;
      sessionStorage.setItem("mb-auto-reload", JSON.stringify({ build: targetBuild, at: Date.now() }));
    } catch (e) {}
    reloading = true;
    window.location.reload();
  }

  var retryTimer = null;
  function tryApply(reason) {
    if (!updateReady || reloading) return;
    if (isSafe(reason)) return doReload();
    // ننتظر أن يزول المانع (طلب جارٍ...) ونعيد المحاولة بهدوء فقط ما دام التطبيق مخفيًا.
    if (reason === "hidden" && !retryTimer) {
      retryTimer = setTimeout(function () {
        retryTimer = null;
        if (document.visibilityState === "hidden") tryApply("hidden");
      }, 4000);
    }
  }
  function markUpdateReady(build) {
    updateReady = true;
    targetBuild = build || targetBuild || "sw";
    if (document.visibilityState === "hidden") tryApply("hidden");
  }

  // ---- الانتقال بين الصفحات داخل التطبيق = نقطة آمنة ----
  var lastPath = location.pathname;
  function onMaybeRouteChange() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (updateReady && isSafe("route")) return doReload();
    dirty = false;
  }
  try {
    ["pushState", "replaceState"].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(onMaybeRouteChange, 0);
        return r;
      };
    });
    window.addEventListener("popstate", function () { setTimeout(onMaybeRouteChange, 0); });
  } catch (e) {}

  // ---- اكتشاف نسخة جديدة: بصمة ملف البناء الرئيسي في index.html على الخادم ----
  var ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
  var CSS_RE = /\/assets\/[A-Za-z0-9_.-]+\.css/g;
  function currentEntry() {
    var scripts = document.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) {
      var m = ENTRY_RE.exec(scripts[i].getAttribute("src") || "");
      if (m) return m[0];
    }
    return "";
  }
  var loadedEntry = currentEntry(); // فارغ في وضع التطوير => لا فحص
  var lastCheck = 0;
  function checkVersion(reg) {
    var now = Date.now();
    if (now - lastCheck < 60 * 1000) return; // بحدّ أدنى دقيقة بين فحصين
    lastCheck = now;
    if (reg) reg.update().catch(function () {});
    if (!loadedEntry || !rawFetch || updateReady) return;
    rawFetch("/", { cache: "no-store", credentials: "omit" })
      .then(function (res) { return res.ok ? res.text() : ""; })
      .then(function (html) {
        var m = ENTRY_RE.exec(html);
        if (!m || m[0] === loadedEntry) return;
        // نزّل ملفات النسخة الجديدة في الخلفية (تمرّ عبر الـSW فتُخزَّن)، ثم اعتبر التحديث جاهزًا.
        var files = [m[0]].concat(html.match(CSS_RE) || []);
        return Promise.all(files.map(function (f) { return rawFetch(f).catch(function () {}); })).then(function () {
          markUpdateReady(m[0]);
        });
      })
      .catch(function () {});
  }

  // النسخة الجديدة من الـSW نفسه (إن تغيّر sw.js): كما كان، لكن عبر نفس بوابة الأمان.
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) return;
    markUpdateReady("sw");
  });

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/sw.js")
      .then(function (reg) {
        function activateWaiting() {
          if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        }
        activateWaiting();
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed") activateWaiting();
          });
        });

        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") {
            hiddenAt = 0;
            checkVersion(reg);
          } else {
            hiddenAt = Date.now();
            tryApply("hidden");
          }
        });
        window.addEventListener("online", function () { checkVersion(reg); });

        setTimeout(function () { checkVersion(reg); }, 15 * 1000); // بعد الإقلاع بقليل
        setInterval(function () { checkVersion(reg); }, 10 * 60 * 1000); // ثم كل 10 دقائق
      })
      .catch(function () {});
  });
})();

// ===== إغلاق إشعارات المواعيد المنتهية عند فتح التطبيق =====
// إشعار الموعد يحمل data.expiresAt (نهاية يوم الموعد بتوقيت الجزائر). عند فتح التطبيق أو عودته للواجهة
// نُغلق من مركز إشعارات الجهاز ما انتهى منها — في المتصفحات التي تدعم getNotifications()/close().
(function () {
  if (!("serviceWorker" in navigator)) return;
  function closeExpired() {
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg || typeof reg.getNotifications !== "function") return;
      var now = Date.now();
      reg.getNotifications().then(function (list) {
        list.forEach(function (n) {
          var t = n.data && n.data.expiresAt ? Date.parse(n.data.expiresAt) : NaN;
          if (!isNaN(t) && t <= now) n.close();
        });
      }).catch(function () {});
    }).catch(function () {});
  }
  window.addEventListener("load", closeExpired);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") closeExpired();
  });
})();
