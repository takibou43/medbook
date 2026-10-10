import { z } from "zod";

export const prescriptionTemplateSchema = z.object({
  image: z.string().max(1400000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => {
    const bytes = Buffer.from(value.split(",")[1] ?? "", "base64");
    return bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }, "Invalid JPEG image"),
  top: z.number().int().min(10).max(75),
  bottom: z.number().int().min(10).max(60),
  side: z.number().int().min(5).max(30),
}).strict();
