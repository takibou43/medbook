import { z } from "zod";

// Require scalar query strings before coercion: arrays/objects must not reach
// Prisma or expensive geographic searches through TypeScript-only casts.
const numeric = (min: number, max: number) => z.string().min(1).pipe(z.coerce.number().finite().min(min).max(max));
const integer = (min: number, max: number) => numeric(min, max).pipe(z.number().int());

export const doctorSearchSchema = z.object({
  specialtyId: z.string().uuid().optional(),
  wilayaId: z.string().uuid().optional(),
  cityId: z.string().uuid().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  q: z.string().trim().max(100).optional(),
  minRating: numeric(0, 5).optional(),
  page: integer(1, 10000).optional(),
  pageSize: integer(1, 50).optional(),
  lat: numeric(-90, 90).optional(),
  lng: numeric(-180, 180).optional(),
  maxDistanceKm: numeric(0, 20040).optional(),
});

export const doctorIdParams = z.object({ id: z.string().uuid() });
export const doctorAvailabilityQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "تاريخ غير صالح."),
});
