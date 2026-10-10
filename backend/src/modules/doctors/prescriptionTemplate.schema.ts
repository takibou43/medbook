import { z } from "zod";

const logoSchema = z.string().max(400000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => {
  const bytes = Buffer.from(value.split(",")[1] ?? "", "base64");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 360 && height <= 360;
}, "Invalid bounded PNG logo");

export const prescriptionDesignSchema = z.object({
  version: z.literal(1),
  language: z.enum(["ar", "fr"]),
  doctorName: z.string().trim().min(1).max(120),
  specialty: z.string().max(120),
  clinicName: z.string().max(120),
  address: z.string().max(180),
  phone: z.string().max(60),
  footer: z.string().max(240),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  layout: z.enum(["centered", "split"]),
  logo: logoSchema.nullable(),
  logoPosition: z.enum(["left", "right"]),
  headerSize: z.number().int().min(14).max(22),
}).strict();

export const prescriptionTemplateSchema = z.object({
  design: prescriptionDesignSchema.nullable().optional(),
  image: z.string().max(1400000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => {
    const bytes = Buffer.from(value.split(",")[1] ?? "", "base64");
    return bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }, "Invalid JPEG image"),
  top: z.number().int().min(10).max(75),
  bottom: z.number().int().min(10).max(60),
  side: z.number().int().min(5).max(30),
}).strict();
