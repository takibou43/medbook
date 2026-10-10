import { describe, expect, it } from "vitest";
import { prescriptionTemplateSchema } from "../src/modules/doctors/prescriptionTemplate.schema";

const image = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(120), Buffer.from([255, 217])]).toString("base64")}`;
const valid = { image, top: 40, bottom: 30, side: 12 };
describe("blank prescription stationery validation", () => {
  it("accepts bounded layout and a JPEG envelope", () => {
    expect(prescriptionTemplateSchema.parse(valid)).toEqual(valid);
  });
  it.each(["data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/image.jpg", "data:image/jpeg;base64,YWJj", "data:image/jpeg;base64,!!!!"])("rejects active, remote or malformed images: %s", image => {
    expect(prescriptionTemplateSchema.safeParse({ ...valid, image }).success).toBe(false);
  });
  it("rejects patient data and caller-selected ownership", () => {
    expect(prescriptionTemplateSchema.safeParse({ ...valid, patientName: "example" }).success).toBe(false);
    expect(prescriptionTemplateSchema.safeParse({ ...valid, doctorId: "other" }).success).toBe(false);
  });
  it("rejects oversized images and margins that remove the writing area", () => {
    expect(prescriptionTemplateSchema.safeParse({ ...valid, image: "a".repeat(1400001) }).success).toBe(false);
    expect(prescriptionTemplateSchema.safeParse({ ...valid, top: 150 }).success).toBe(false);
    expect(prescriptionTemplateSchema.safeParse({ ...valid, side: 0 }).success).toBe(false);
  });
});
