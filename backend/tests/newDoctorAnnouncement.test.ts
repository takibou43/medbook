import { describe, it, expect } from "vitest";
import { newDoctorAnnouncement } from "../src/lib/newDoctorAnnouncement";

const doctor = { id: "doctor", firstName: "أمين", lastName: "الاختبار", wilayaId: "wilaya", city: { nameAr: "ميلة" }, specialty: { nameAr: "طب الأسنان" } };

describe("new doctor clinic announcement", () => {
  it("names the clinic in the patient message and phone notification", () => {
    const announcement = newDoctorAnnouncement({ ...doctor, clinic: { nameAr: "الأمل" } });
    expect(announcement.title).toBe("طبيب جديد تابع لعيادة في ولايتك");
    expect(announcement.message.includes("عيادة الأمل")).toBe(true);
    expect(announcement.message.includes("أمين الاختبار")).toBe(true);
    expect(announcement.message.includes("طب الأسنان")).toBe(true);
    expect(announcement.pushBody.includes("عيادة الأمل")).toBe(true);
  });
  it("keeps the independent doctor's announcement", () => {
    const announcement = newDoctorAnnouncement({ ...doctor, clinic: null });
    expect(announcement.title).toBe("طبيب جديد في ولايتك");
    expect(announcement.message.includes("إلى مادبوك")).toBe(true);
  });
});
