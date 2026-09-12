import { defineConfig } from "vitest/config";

/**
 * إعدادات الاختبارات.
 *
 * setupFiles: يضبط قيمًا افتراضية آمنة لمتغيرات البيئة قبل تحميل أي ملف اختبار، حتى تعمل
 * اختبارات المنطق النقي (slots / transitions / jwt / password) دون الحاجة إلى ملف .env
 * ولا إلى قاعدة بيانات فعلية — كما هو موثّق في README.
 *
 * testTimeout: استيراد شجرة وحدات الخادم كاملة (src/app.ts) في أول تشغيل يستغرق أكثر من
 * 5 ثوانٍ على أجهزة Windows، لذلك رُفع السقف الافتراضي حتى لا يفشل smoke test بلا سبب.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
