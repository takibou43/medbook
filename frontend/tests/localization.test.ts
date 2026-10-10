import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { t, getLanguage, getLocale, setLanguage, catalogName, subscribeLanguage } from "../src/i18n/locale.ts";
import { beneficiaryLabel } from "../src/lib/family.ts";

test("language changes preserve canonical data and interpolate patient names verbatim", () => {
  try {
    setLanguage("fr");
    assert.equal(getLocale(), "fr-DZ");
    assert.equal(t("تأكيد الحجز"), "Confirmer la réservation");
    assert.equal(t("د. {0} {1}", {0:"آمنة",1:"بن علي"}), "Dr آمنة بن علي");
    assert.equal(beneficiaryLabel({type:"FAMILY_MEMBER",name:"ياسين بن علي",relationship:"CHILD",familyMemberId:"family-child-1"}), "ياسين بن علي (Enfant)");
    assert.equal(catalogName({nameAr:"طب الأسنان",nameFr:"Médecine dentaire"}), "Médecine dentaire");
    assert.equal(catalogName({nameAr:"اسم محلي"}), "اسم محلي");
    assert.equal(t(" غير معروف "), " غير معروف ");
    assert.equal(t(" الطبيب "), " Médecin ");
  } finally { setLanguage("ar"); }
  assert.equal(getLanguage(), "ar");
  assert.equal(t("نادي المريض التالي"), "نادِ المريض التالي");
});

test("language listeners notify once per actual change and can unsubscribe", () => {
  let changes=0;
  const unsubscribe=subscribeLanguage(()=>changes++);
  try {
    setLanguage("fr"); setLanguage("fr");
    assert.equal(changes,1);
    unsubscribe(); setLanguage("ar");
    assert.equal(changes,1);
  } finally { unsubscribe();setLanguage("ar"); }
});

test("both portals ship identical catalogs and preserve all interpolation parameters", () => {
  const patient=JSON.parse(readFileSync(new URL("../src/i18n/fr.json",import.meta.url),"utf8"));
  const staff=JSON.parse(readFileSync(new URL("../../frontend-doctor/src/i18n/fr.json",import.meta.url),"utf8"));
  assert.deepEqual(patient,staff);
  for(const [key,value] of Object.entries(patient)) {
    const placeholders=(text:string)=>[...text.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
    assert.deepEqual(placeholders(key),placeholders(value as string),key);
    assert.ok((value as string).trim(),key);
  }
});
