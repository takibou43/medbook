import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_COLLAPSED_KEY, accountDisplayName, initialsOf, readSidebarCollapsed, roleLabel, splitNavItems, writeSidebarCollapsed } from "../src/lib/sidebar.ts";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test("تفضيل الطي يُحفظ ويُقرأ، والافتراضي موسّعة", () => {
  const s = memory();
  assert.equal(readSidebarCollapsed(s), false);
  writeSidebarCollapsed(true, s);
  assert.equal(s.m.get(SIDEBAR_COLLAPSED_KEY), "1");
  assert.equal(readSidebarCollapsed(s), true);
  writeSidebarCollapsed(false, s);
  assert.equal(readSidebarCollapsed(s), false);
});

test("تخزين معطّل أو يرمي خطأ لا يكسر القائمة", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readSidebarCollapsed(broken), false);
  assert.doesNotThrow(() => writeSidebarCollapsed(true, broken));
  assert.equal(readSidebarCollapsed(null), false);
});

test("الأحرف الأولى", () => {
  assert.equal(initialsOf("د. أمين بلقاسم"), "دأ");
  assert.equal(initialsOf("Sara Ben"), "SB");
  assert.equal(initialsOf("admin@medbook.dz"), "AM");
  assert.equal(initialsOf(""), "؟");
});

test("اسم الدور والاسم المعروض", () => {
  assert.equal(roleLabel("ASSISTANT"), "مساعد");
  assert.equal(roleLabel("ADMIN"), "مدير المنصة");
  assert.equal(accountDisplayName({ role: "DOCTOR", doctor: { firstName: "أمين", lastName: "بلقاسم" } }), "د. أمين بلقاسم");
  assert.equal(accountDisplayName({ role: "ADMIN", email: "a@b.dz" }), "a@b.dz");
  assert.equal(accountDisplayName({ role: "CLINIC_OWNER", ownedClinic: { nameAr: "عيادة النور" } }), "عيادة النور");
});

test("تقسيم الروابط يحفظ الترتيب ولا يُسقط أي رابط", () => {
  const items = [{ to: "/" }, { to: "/settings", footer: true }, { to: "/patients" }];
  const { main, footer } = splitNavItems(items);
  assert.deepEqual(main.map((i) => i.to), ["/", "/patients"]);
  assert.deepEqual(footer.map((i) => i.to), ["/settings"]);
  assert.equal(main.length + footer.length, items.length);
});
