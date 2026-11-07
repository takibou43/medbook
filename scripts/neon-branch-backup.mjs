#!/usr/bin/env node
// نسخة احتياطية أسبوعية لقاعدة MedBook كفرع Neon بلا حوسبة (copy-on-write).
// تنبيه: فرع Neon ليس نسخة مستقلة خارج المزود؛ يحمي من الحذف الخاطئ أو ترحيل سيئ، لا من فقدان حساب Neon.
// البيانات لا تغادر حساب Neon، ولا يُطبع منها شيء؛ السجل يحوي أسماء الفروع فقط.
//
// الاحتفاظ: آخر KEEP نسخ تلقائية (بادئة auto-backup-). لا يُحذف أبدًا فرع بلا هذه البادئة
// (الإنتاج، النسخ اليدوية، فروع الاستعادة)، ولا يُطبَّق الاحتفاظ قبل التحقق من النسخة الجديدة.
// الحذف عند إنشاء فاشل يحدث فقط إذا كان السبب امتلاء الفروع (HTTP 422 «branches limit exceeded»)
// ووُجدت نسختان تلقائيتان على الأقل، فتبقى نسخة سليمة دائمًا.
//
// المتغيرات: NEON_API_KEY (سر GitHub)، NEON_PROJECT_ID، NEON_PARENT_BRANCH_ID، KEEP (افتراضيًا 2).

export const PREFIX = "auto-backup-";
export const NOT_CONFIGURED_EXIT = 2;

const isAuto = (b) => typeof b?.name === "string" && b.name.startsWith(PREFIX) && !b.primary && !b.default;
const newestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

/** معرّفات النسخ التلقائية الزائدة عن keep، بعد احتساب النسخ المحمية (الجديدة الموثّقة) ضمن keep. */
export function planRotation(branches, { keep = 2, protectIds = [] } = {}) {
  if (!(Number.isInteger(keep) && keep >= 1)) throw new Error("KEEP يجب أن يكون عددًا صحيحًا ≥ 1");
  const protectedAutos = branches.filter((b) => isAuto(b) && protectIds.includes(b.id));
  const others = branches.filter((b) => isAuto(b) && !protectIds.includes(b.id)).sort(newestFirst);
  return others.slice(Math.max(0, keep - protectedAutos.length)).map((b) => b.id);
}

export class NeonApiError extends Error {
  constructor(method, status, body) {
    super(`Neon API ${method} -> HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** امتلاء الفروع فقط؛ الشبكة والصلاحيات و429 و5xx وغيرها لا تُعامَل كامتلاء. */
export function isBranchLimitError(err) {
  if (!(err instanceof NeonApiError) || err.status !== 422) return false;
  let parsed = {};
  try { parsed = JSON.parse(err.body || "{}"); } catch { /* نص غير JSON */ }
  const code = String(parsed.code ?? "");
  const message = String(parsed.message ?? err.body ?? "");
  return code === "BRANCHES_LIMIT_EXCEEDED" || /branches limit exceeded/i.test(message);
}

export async function runBackup({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, now = () => new Date() } = {}) {
  const { NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID } = env;
  if (!NEON_API_KEY) return { status: "not-configured" };
  const keep = Number(env.KEEP ?? 2);
  if (!NEON_PROJECT_ID || !NEON_PARENT_BRANCH_ID || !(Number.isInteger(keep) && keep >= 1)) throw new Error("NEON_PROJECT_ID / NEON_PARENT_BRANCH_ID / KEEP غير صالحة");

  async function api(method, path, body) {
    const res = await fetchImpl(`https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${NEON_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new NeonApiError(method, res.status, text.slice(0, 300));
    return text ? JSON.parse(text) : {};
  }
  const list = async () => (await api("GET", "/branches")).branches ?? [];
  const name = PREFIX + now().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const create = () => api("POST", "/branches", { branch: { name, parent_id: NEON_PARENT_BRANCH_ID } });

  let created;
  try {
    created = await create();
  } catch (err) {
    if (!isBranchLimitError(err)) throw err; // لا حذف عند أي خطأ آخر
    const autos = (await list()).filter(isAuto).sort(newestFirst);
    if (autos.length < 2) throw new Error("الفروع ممتلئة (10/10) ولا توجد نسختان تلقائيتان يمكن تدوير أقدمهما مع إبقاء نسخة سليمة. حرّر خانة يدويًا.");
    await api("DELETE", `/branches/${autos[autos.length - 1].id}`);
    log("الفروع ممتلئة: حُذفت أقدم نسخة تلقائية، وبقيت نسخة تلقائية سليمة على الأقل.");
    created = await create(); // إن فشلت هذه المحاولة يتوقف كل شيء دون حذف آخر
  }

  const id = created?.branch?.id;
  if (typeof id !== "string" || !/^br-[a-z0-9-]+$/.test(id) || created.branch.name !== name) throw new Error("رد الإنشاء لا يحوي معرّف النسخة المتوقع؛ لا يُطبَّق الاحتفاظ.");
  log(`أُنشئت النسخة ${name}.`);

  let ready = null;
  for (let i = 0; i < 30; i += 1) {
    const b = (await api("GET", `/branches/${id}`)).branch;
    if (b?.id === id && b.parent_id === NEON_PARENT_BRANCH_ID && b.current_state === "ready") { ready = b; break; }
    await sleep(10_000);
  }
  if (!ready) throw new Error("النسخة لم تصبح جاهزة خلال 5 دقائق؛ لا يُطبَّق الاحتفاظ.");
  log("النسخة جاهزة ومرتبطة بفرع الإنتاج.");

  const removed = [];
  for (const old of planRotation(await list(), { keep, protectIds: [id] })) {
    await api("DELETE", `/branches/${old}`);
    removed.push(old);
  }
  if (removed.length) log(`حُذفت ${removed.length} نسخة تلقائية أقدم من حد الاحتفاظ (${keep}).`);
  return { status: "ok", id, name, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup().then((r) => {
    if (r.status === "not-configured") {
      console.error("::error title=النسخ الآلي غير مفعّل::السر NEON_API_KEY غير مضبوط؛ لم تُؤخذ أي نسخة.");
      process.exit(NOT_CONFIGURED_EXIT);
    }
  }).catch((err) => { console.error(`::error title=فشل النسخ الاحتياطي::${err.message}`); process.exit(1); });
}
