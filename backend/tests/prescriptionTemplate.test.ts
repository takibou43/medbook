import { describe, expect, it } from "vitest";
import { prescriptionTemplateSchema, prescriptionDesignSchema } from "../src/modules/doctors/prescriptionTemplate.schema";

const image = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(120), Buffer.from([255, 217])]).toString("base64")}`;
const valid = { image, top: 40, bottom: 30, side: 12 };
const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=";
const design = { version: 1, language: "ar", doctorName: "اسم تجريبي", specialty: "", clinicName: "", address: "", phone: "", footer: "", color: "#187f77", layout: "split", logo, logoPosition: "left", headerSize: 18 };
describe("editable blank prescription design", () => {
  it("accepts bounded settings alongside the printable image and preserves image-only compatibility", () => {
    expect(prescriptionTemplateSchema.parse({ ...valid, design }).design).toEqual(design);
    expect(prescriptionTemplateSchema.parse({ ...valid, design: null }).design).toBeNull();
    expect(prescriptionTemplateSchema.parse(valid).design).toBeUndefined();
  });
  it.each(["https://example.com/logo.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,YWJj"])("rejects unsafe/remote/malformed logos: %s", logo => {
    expect(prescriptionDesignSchema.safeParse({ ...design, logo }).success).toBe(false);
  });
  it("rejects excessive dimensions and metadata, arbitrary colors, invalid sizes and extra patient fields", () => {
    const bytes = Buffer.from(logo.split(",")[1], "base64"); bytes.writeUInt32BE(20000, 16);
    for (const change of [{ logo: `data:image/png;base64,${bytes.toString("base64")}` }, { address: "a".repeat(181) }, { color: "url(https://example.com)" }, { headerSize: 99 }, { patientName: "example" }, { logo: "a".repeat(400001) }]) {
      expect(prescriptionDesignSchema.safeParse({ ...design, ...change }).success).toBe(false);
    }
  });
});
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
