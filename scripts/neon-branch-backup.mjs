#!/usr/bin/env node
// نسخة احتياطية أسبوعية لقاعدة MedBook كفرع Neon بلا حوسبة (copy-on-write).
// البيانات لا تغادر حساب Neon الخاص، ولا تُطبع ولا تُرفع إلى GitHub؛ السجل يحوي أسماء الفروع فقط.
// الاحتفاظ: آخر KEEP نسخ تلقائية (بادئة auto-backup-). لا يحذف أبدًا فرعًا بلا هذه البادئة
// ولا الفرع الرئيسي ولا النسخة التي أُنشئت للتو. خطة Neon المجانية: 10 فروع لكل مشروع.
//
// المتغيرات: NEON_API_KEY (سر GitHub)، NEON_PROJECT_ID، NEON_PARENT_BRANCH_ID، KEEP (افتراضيًا 2).

export const PREFIX = "auto-backup-";

/** يقرر أي النسخ التلقائية تُحذف لإبقاء آخر keep منها. دالة نقية قابلة للاختبار. */
export function planRotation(branches, { keep = 2, protectIds = [] } = {}) {
  const autos = branches
    .filter((b) => typeof b.name === "string" && b.name.startsWith(PREFIX) && !b.primary && !b.default && !protectIds.includes(b.id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const keepCount = Math.max(1, keep - protectIds.length);
  return autos.slice(keepCount).map((b) => b.id);
}

async function neon(path, init = {}) {
  const res = await fetch(`https://console.neon.tech/api/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Neon API ${init.method ?? "GET"} ${path.replace(/\/[^/]+$/, "/…")} -> ${res.status}`), { status: res.status, body: text.slice(0, 300) });
  return text ? JSON.parse(text) : {};
}

async function main() {
  const { NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID } = process.env;
  const keep = Number(process.env.KEEP ?? 2);
  if (!NEON_API_KEY) { console.log("NEON_API_KEY غير مضبوط بعد؛ لا شيء يُنفَّذ."); return; }
  if (!NEON_PROJECT_ID || !NEON_PARENT_BRANCH_ID || !(keep >= 1)) throw new Error("NEON_PROJECT_ID / NEON_PARENT_BRANCH_ID / KEEP غير صالحة");

  const name = PREFIX + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const list = async () => (await neon(`/projects/${NEON_PROJECT_ID}/branches`)).branches ?? [];
  const create = () => neon(`/projects/${NEON_PROJECT_ID}/branches`, { method: "POST", body: JSON.stringify({ branch: { name, parent_id: NEON_PARENT_BRANCH_ID } }) });

  let created;
  try {
    created = await create();
  } catch (err) {
    // الحد الأقصى للفروع: يُحذف أقدم نسخة تلقائية واحدة فقط، ثم إعادة المحاولة مرة واحدة.
    const autos = planRotation(await list(), { keep: 1 });
    if (!autos.length) throw new Error(`تعذّر إنشاء النسخة (${err.status}) ولا توجد نسخة تلقائية قديمة يمكن تدويرها. حرّر خانة فرع في Neon يدويًا.`);
    const oldest = autos[autos.length - 1];
    await neon(`/projects/${NEON_PROJECT_ID}/branches/${oldest}`, { method: "DELETE" });
    console.log("حُذفت أقدم نسخة تلقائية لتحرير خانة.");
    created = await create();
  }
  const id = created.branch?.id;
  console.log(`أُنشئت النسخة ${name}.`);

  for (let i = 0; i < 30; i += 1) {
    const b = (await neon(`/projects/${NEON_PROJECT_ID}/branches/${id}`)).branch;
    if (b?.current_state === "ready") break;
    if (i === 29) throw new Error("النسخة لم تصبح جاهزة خلال 5 دقائق");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log("النسخة جاهزة.");

  for (const old of planRotation(await list(), { keep, protectIds: [id] })) {
    await neon(`/projects/${NEON_PROJECT_ID}/branches/${old}`, { method: "DELETE" });
    console.log("حُذفت نسخة تلقائية أقدم من حد الاحتفاظ.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
