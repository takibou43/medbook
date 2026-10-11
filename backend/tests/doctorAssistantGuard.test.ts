import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    doctor: { findUnique: vi.fn(), findMany: vi.fn() },
    assistant: { findFirst: vi.fn() },
    $executeRaw: vi.fn(async () => 0),
  },
}));
vi.mock("../src/lib/prisma", () => ({ prisma: mocks.db }));

import { ApiError } from "../src/utils/ApiError";
import {
  DOCTOR_HAS_ASSISTANT_MESSAGE, assertDoctorMayCreateAppointments, clinicDoctorIds, doctorHasActiveAssistant, lockDoctorsForAssistantChange,
} from "../src/lib/doctorAssistants";
import { summarizeSubscription } from "../src/lib/doctorSubscriptionSummary";
import { readFileSync } from "fs";
import { join } from "path";

describe("doctorHasActiveAssistant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("طبيب بلا مساعد ⇒ false، ومعه مساعد فعلي ⇒ true", async () => {
    mocks.db.doctor.findUnique.mockResolvedValue({ clinicId: null });
    mocks.db.assistant.findFirst.mockResolvedValueOnce(null);
    expect(await doctorHasActiveAssistant("d1")).toBe(false);
    mocks.db.assistant.findFirst.mockResolvedValueOnce({ id: "a1" });
    expect(await doctorHasActiveAssistant("d1")).toBe(true);
  });

  it("المعطَّل وحساب المستخدم المعطَّل لا يُحتسبان (الشرط في الاستعلام نفسه)", async () => {
    mocks.db.doctor.findUnique.mockResolvedValue({ clinicId: null });
    mocks.db.assistant.findFirst.mockResolvedValue(null);
    await doctorHasActiveAssistant("d1");
    const where = mocks.db.assistant.findFirst.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.user).toEqual({ isActive: true });
    expect(where.OR).toEqual([{ clinicId: null, doctorId: "d1" }]);
  });

  it("طبيب في عيادة: يُحتسب أيضًا مساعد العيادة الذي يغطّيه (الكل أو ضمن المحدَّدين)", async () => {
    mocks.db.doctor.findUnique.mockResolvedValue({ clinicId: "c1" });
    mocks.db.assistant.findFirst.mockResolvedValue({ id: "a" });
    expect(await doctorHasActiveAssistant("d1")).toBe(true);
    const where = mocks.db.assistant.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { clinicId: null, doctorId: "d1" },
      { clinicId: "c1", OR: [{ allDoctors: true }, { allowedDoctorIds: { has: "d1" } }] },
    ]);
  });

  it("طبيب غير موجود ⇒ false بلا استعلام مساعدين", async () => {
    mocks.db.doctor.findUnique.mockResolvedValue(null);
    expect(await doctorHasActiveAssistant("nope")).toBe(false);
    expect(mocks.db.assistant.findFirst).not.toHaveBeenCalled();
  });
});

describe("assertDoctorMayCreateAppointments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("يرمي 403 برسالة عربية مفهومة عند وجود مساعد", async () => {
    mocks.db.doctor.findUnique.mockResolvedValue({ clinicId: null });
    mocks.db.assistant.findFirst.mockResolvedValue({ id: "a" });
    const err = await assertDoctorMayCreateAppointments("d1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe(DOCTOR_HAS_ASSISTANT_MESSAGE);
    expect(err.message).toContain("مساعد");
  });

  it("لا يرمي حين لا مساعد، ويقرأ من المعاملة الممرَّرة لا من الاتصال العام", async () => {
    const tx = { doctor: { findUnique: vi.fn(async () => ({ clinicId: null })) }, assistant: { findFirst: vi.fn(async () => null) } };
    await expect(assertDoctorMayCreateAppointments("d1", tx as never)).resolves.toBeUndefined();
    expect(tx.assistant.findFirst).toHaveBeenCalledOnce();
    expect(mocks.db.assistant.findFirst).not.toHaveBeenCalled();
  });
});

describe("أقفال تغيير المساعدين", () => {
  beforeEach(() => vi.clearAllMocks());

  it("تُقفل أطباء متأثرون مرتبين بلا تكرار (تفادي التشابك)", async () => {
    const calls: string[] = [];
    const tx = { $executeRaw: vi.fn(async (_s: TemplateStringsArray, key: string) => { calls.push(key); return 0; }) };
    await lockDoctorsForAssistantChange(tx as never, ["b", "a", "b", "c"]);
    expect(calls).toEqual(["doctor-queue:a", "doctor-queue:b", "doctor-queue:c"]);
  });

  it("clinicDoctorIds يعيد معرّفات أطباء العيادة", async () => {
    const tx = { doctor: { findMany: vi.fn(async () => [{ id: "x" }, { id: "y" }]) } };
    expect(await clinicDoctorIds(tx as never, "c1")).toEqual(["x", "y"]);
    expect(tx.doctor.findMany).toHaveBeenCalledWith({ where: { clinicId: "c1" }, select: { id: true } });
  });
});

describe("summarizeSubscription", () => {
  const base = { subscriptionStatus: "ACTIVE" as const, subscriptionExpiresAt: null, newDoctorTrial: false, platformTrialEnd: null };

  it("اشتراك ضمن عيادة لها مالك ⇒ CLINIC مع اسمها دون تاريخ مخترع", () => {
    const s = summarizeSubscription({ ...base, active: true, clinic: { nameAr: "الأمل", ownerId: "u", subscriptionExpiresAt: null } });
    expect(s).toEqual({ kind: "CLINIC", active: true, clinicName: "الأمل", expiresAt: null });
  });

  it("عيادة بلا مالك (قديمة) تبقى فوترة مستقلة", () => {
    const s = summarizeSubscription({ ...base, active: true, clinic: { nameAr: "قديمة", ownerId: null, subscriptionExpiresAt: null } });
    expect(s.kind).toBe("ACTIVE");
    expect(s.clinicName).toBeNull();
  });

  it("تجربة الطبيب الجديد أو تجربة المنصة العامة ⇒ TRIAL", () => {
    expect(summarizeSubscription({ ...base, active: true, clinic: null, newDoctorTrial: true }).kind).toBe("TRIAL");
    const end = new Date("2026-12-31T23:59:59Z");
    expect(summarizeSubscription({ ...base, active: true, clinic: null, subscriptionExpiresAt: end, platformTrialEnd: end }).kind).toBe("TRIAL");
    expect(summarizeSubscription({ ...base, active: true, clinic: null, subscriptionExpiresAt: new Date("2027-03-01"), platformTrialEnd: end }).kind).toBe("ACTIVE");
  });

  it("منتهٍ ⇒ EXPIRED، ولم يُمنح قط ⇒ NONE", () => {
    expect(summarizeSubscription({ ...base, active: false, clinic: null, subscriptionStatus: "EXPIRED", subscriptionExpiresAt: new Date("2026-01-01") }).kind).toBe("EXPIRED");
    expect(summarizeSubscription({ ...base, active: false, clinic: null, subscriptionStatus: "UNPAID" }).kind).toBe("NONE");
  });
});

describe("نطاق المنع: الحجز الذاتي وwalk-in المساعد لا يمسّان", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");

  it("الحارس موجود في حجز الطبيب للضيف (قبل المعاملة وداخلها)", () => {
    const src = read("modules/treatment/followUpAppointment.service.ts");
    const uses = src.match(/assertDoctorMayCreateAppointments\(/g) ?? [];
    expect(uses.length).toBe(2);
    expect(src).toMatch(/assertDoctorMayCreateAppointments\(doctor\.id, tx\)/);
  });

  it("حجز المريض وwalk-in المساعد لا يستدعيان الحارس", () => {
    expect(read("modules/appointments/appointments.service.ts")).not.toContain("assertDoctorMayCreateAppointments");
    expect(read("modules/appointments/walkIn.service.ts")).not.toContain("assertDoctorMayCreateAppointments");
    expect(read("modules/booking/booking.service.ts")).not.toContain("assertDoctorMayCreateAppointments");
  });

  it("كل نقاط تعديل المساعدين تأخذ قفل الطابور", () => {
    expect(read("modules/assistants/assistants.service.ts").match(/lockDoctorsForAssistantChange\(/g)?.length).toBe(2);
    expect(read("modules/clinics/clinics.service.ts").match(/lockDoctorsForAssistantChange\(/g)?.length).toBe(2);
  });
});
