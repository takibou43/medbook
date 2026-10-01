// حارس CI: يفشل إذا بقي أي ملف تكامل متخطّى رغم ضبط TEST_DATABASE_URL.
// يقرأ تقرير Vitest بصيغة JSON (--reporter=json --outputFile.json=...).
// الاستثناء الوحيد: اختبار الحمل clinicDay.load (اختياري، يُفعّل بـ RUN_CLINIC_LOAD=1).
import fs from "node:fs";
import path from "node:path";

const reportPath = process.argv[2] ?? "vitest-report.json";
const OPTIONAL = new Set(["clinicDay.load.test.ts"]);

if (!process.env.TEST_DATABASE_URL) {
  console.error("TEST_DATABASE_URL غير مضبوط: لا معنى لهذا الحارس بدون قاعدة اختبار.");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const integrationDir = path.join("tests", "integration");
const expected = fs
  .readdirSync(integrationDir)
  .filter((f) => f.endsWith(".test.ts") && !OPTIONAL.has(f));

const problems = [];
let ran = 0;
for (const file of expected) {
  const result = report.testResults.find((r) => r.name.replaceAll("\\", "/").endsWith(`tests/integration/${file}`));
  if (!result) {
    problems.push(`${file}: غير موجود في التقرير`);
    continue;
  }
  const statuses = result.assertionResults.map((a) => a.status);
  const passed = statuses.filter((s) => s === "passed").length;
  const skipped = statuses.filter((s) => s === "skipped" || s === "pending" || s === "todo").length;
  // booking.integration يحتوي حالة افتراضية تتطلب قاعدة؛ أي حالة متخطاة في ملف تكامل = فشل.
  if (skipped > 0 || passed === 0) problems.push(`${file}: ${passed} ناجح، ${skipped} متخطّى`);
  else ran += 1;
}

console.log(`ملفات التكامل التي عملت فعلًا: ${ran}/${expected.length}`);
console.log(
  `إجمالي الاختبارات: ${report.numTotalTests}، ناجح: ${report.numPassedTests}، فاشل: ${report.numFailedTests}، متخطّى: ${report.numPendingTests}`,
);
if (problems.length) {
  console.error("ملفات تكامل لم تعمل كما يجب:\n- " + problems.join("\n- "));
  process.exit(1);
}
if (report.numFailedTests > 0 || report.success === false) {
  console.error("توجد اختبارات فاشلة.");
  process.exit(1);
}
