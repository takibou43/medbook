/** Add missing reference specialties only; never run the demonstration seed on production. */
import { PrismaClient } from "@prisma/client";
import catalog from "../src/data/algeria-specialties.json";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "");

async function main() {
  const existing = await prisma.specialty.findMany({ select: { nameAr: true, nameFr: true } });
  const names = new Set(existing.flatMap(s => [normalize(s.nameAr), ...(s.nameFr ? [normalize(s.nameFr)] : [])]));
  const missing = catalog.filter(([ar, fr]) => !names.has(normalize(ar)) && !names.has(normalize(fr)));
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", catalogCount: catalog.length, missingCount: missing.length, missing }, null, 2));
  if (apply && missing.length) {
    await prisma.$transaction(missing.map(([nameAr, nameFr]) => prisma.specialty.upsert({
      where: { nameAr }, update: {}, create: { nameAr, nameFr, icon: "stethoscope" },
    })));
    console.log(`Added ${missing.length} specialties; existing records were preserved.`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
