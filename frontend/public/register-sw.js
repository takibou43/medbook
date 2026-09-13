// تسجيل الـservice worker وإدارة التحديث التلقائي.
// ملف مستقل (وليس داخل index.html) حتى يبقى الـHTML نظيفًا، وهو خارج /assets/ فلا يُخزَّن
// في الكاش أبدًا. فشله لا يؤثر في عمل الموقع إطلاقًا.
(function () {
  if (!("serviceWorker" in navigator)) return;

  // هل كانت هناك نسخة تتحكّم بالصفحة قبل الآن؟ إن لا، فهذه أول زيارة وتفعيل النسخة
  // الأولى أمر طبيعي لا يستدعي إعادة تحميل.
  var hadController = !!navigator.serviceWorker.controller;
  var reloaded = false;
  var pendingReload = false;

  function reloadOnce() {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  }

  // لا نعيد التحميل والمستخدم ينظر إلى الشاشة (قد يكون في منتصف حجز موعد)؛
  // ننتظر حتى يغادر التطبيق إلى الخلفية، فيجد عند عودته أحدث نسخة جاهزة.
  function scheduleReload() {
    if (document.visibilityState === "hidden") reloadOnce();
    else pendingReload = true;
  }

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) return;
    scheduleReload();
  });

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/sw.js")
      .then(function (reg) {
        function checkForUpdate() {
          reg.update().catch(function () {});
        }

        // إن وُجدت نسخة جديدة منتظرة (مثلًا نُشر تحديث والتطبيق مفتوح) نفعّلها فورًا؛
        // الـSW نفسه يستدعي skipWaiting، وهذه الرسالة تغطّي الحالات التي ينتظر فيها.
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
          if (document.visibilityState === "visible") checkForUpdate();
          else if (pendingReload) reloadOnce();
        });

        // فحص دوري خفيف (مرة كل ساعة) لالتقاط أي نشر جديد دون تدخّل المستخدم.
        setInterval(checkForUpdate, 60 * 60 * 1000);
      })
      .catch(function () {});
  });
})();
