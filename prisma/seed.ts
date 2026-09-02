/**
 * MedBook — Seed Script
 * يملأ قاعدة البيانات ببيانات جزائرية واقعية للتجربة المحلية.
 * تشغيل: npm run db:seed  (من مجلد backend)
 */
// ملاحظة: يُستورد من المسار الصريح داخل backend/node_modules لأن seed.ts يقع خارج backend/
// (عميل Prisma المُولَّد يُكتب هناك حسب generator.output في schema.prisma)، وimport باسم الحزمة
// المجرد "@prisma/client" قد يُحلّ خطأً إلى نسخة أخرى في جذر المشروع لا تحتوي العميل المُولَّد فعليًا.
import { PrismaClient, Role, Gender, VerificationStatus, AppointmentStatus, ConsultationType } from "../backend/node_modules/@prisma/client";
// نفس السبب: bcryptjs مثبتة داخل backend/node_modules فقط.
import bcrypt from "../backend/node_modules/bcryptjs";

import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

// كل بلديات الجزائر (1541 بلدية) مفهرسة برمز الولاية — ملف بيانات مرجعية بجانب هذا السكربت.
const ALL_COMMUNES: Record<string, string[]> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "algeria_communes.json"), "utf-8")
);

const WILAYAS: { code: string; nameAr: string; nameFr: string; cities: string[] }[] = [
  { code: "01", nameAr: "أدرار", nameFr: "Adrar", cities: ["أدرار"] },
  { code: "02", nameAr: "الشلف", nameFr: "Chlef", cities: ["الشلف"] },
  { code: "03", nameAr: "الأغواط", nameFr: "Laghouat", cities: ["الأغواط"] },
  { code: "04", nameAr: "أم البواقي", nameFr: "Oum El Bouaghi", cities: ["أم البواقي", "عين مليلة"] },
  { code: "05", nameAr: "باتنة", nameFr: "Batna", cities: ["باتنة", "بريكة", "عين التوتة"] },
  { code: "06", nameAr: "بجاية", nameFr: "Béjaïa", cities: ["بجاية", "أقبو", "سيدي عيش"] },
  { code: "07", nameAr: "بسكرة", nameFr: "Biskra", cities: ["بسكرة"] },
  { code: "08", nameAr: "بشار", nameFr: "Béchar", cities: ["بشار"] },
  { code: "09", nameAr: "البليدة", nameFr: "Blida", cities: ["البليدة", "بوفاريك", "موزاية"] },
  { code: "10", nameAr: "البويرة", nameFr: "Bouira", cities: ["البويرة"] },
  { code: "11", nameAr: "تمنراست", nameFr: "Tamanrasset", cities: ["تمنراست"] },
  { code: "12", nameAr: "تبسة", nameFr: "Tébessa", cities: ["تبسة"] },
  { code: "13", nameAr: "تلمسان", nameFr: "Tlemcen", cities: ["تلمسان", "مغنية", "ندرومة"] },
  { code: "14", nameAr: "تيارت", nameFr: "Tiaret", cities: ["تيارت"] },
  { code: "15", nameAr: "تيزي وزو", nameFr: "Tizi Ouzou", cities: ["تيزي وزو"] },
  { code: "16", nameAr: "الجزائر", nameFr: "Alger", cities: ["الجزائر الوسطى", "باب الزوار", "بئر مراد رايس", "الحراش"] },
  { code: "17", nameAr: "الجلفة", nameFr: "Djelfa", cities: ["الجلفة"] },
  { code: "18", nameAr: "جيجل", nameFr: "Jijel", cities: ["جيجل"] },
  { code: "19", nameAr: "سطيف", nameFr: "Sétif", cities: ["سطيف", "العلمة", "عين ولمان"] },
  { code: "20", nameAr: "سعيدة", nameFr: "Saïda", cities: ["سعيدة"] },
  { code: "21", nameAr: "سكيكدة", nameFr: "Skikda", cities: ["سكيكدة"] },
  { code: "22", nameAr: "سيدي بلعباس", nameFr: "Sidi Bel Abbès", cities: ["سيدي بلعباس"] },
  { code: "23", nameAr: "عنابة", nameFr: "Annaba", cities: ["عنابة", "الحجار", "برحال"] },
  { code: "24", nameAr: "قالمة", nameFr: "Guelma", cities: ["قالمة"] },
  { code: "25", nameAr: "قسنطينة", nameFr: "Constantine", cities: ["قسنطينة", "الخروب", "عين السمارة"] },
  { code: "26", nameAr: "المدية", nameFr: "Médéa", cities: ["المدية"] },
  { code: "27", nameAr: "مستغانم", nameFr: "Mostaganem", cities: ["مستغانم"] },
  { code: "28", nameAr: "المسيلة", nameFr: "M'Sila", cities: ["المسيلة"] },
  { code: "29", nameAr: "معسكر", nameFr: "Mascara", cities: ["معسكر"] },
  { code: "30", nameAr: "ورقلة", nameFr: "Ouargla", cities: ["ورقلة"] },
  { code: "31", nameAr: "وهران", nameFr: "Oran", cities: ["وهران", "السانيا", "بئر الجير", "عين الترك"] },
  { code: "32", nameAr: "البيض", nameFr: "El Bayadh", cities: ["البيض"] },
  { code: "33", nameAr: "إليزي", nameFr: "Illizi", cities: ["إليزي"] },
  { code: "34", nameAr: "برج بوعريريج", nameFr: "Bordj Bou Arréridj", cities: ["برج بوعريريج"] },
  { code: "35", nameAr: "بومرداس", nameFr: "Boumerdès", cities: ["بومرداس"] },
  { code: "36", nameAr: "الطارف", nameFr: "El Tarf", cities: ["الطارف"] },
  { code: "37", nameAr: "تندوف", nameFr: "Tindouf", cities: ["تندوف"] },
  { code: "38", nameAr: "تسمسيلت", nameFr: "Tissemsilt", cities: ["تسمسيلت"] },
  { code: "39", nameAr: "الوادي", nameFr: "El Oued", cities: ["الوادي"] },
  { code: "40", nameAr: "خنشلة", nameFr: "Khenchela", cities: ["خنشلة"] },
  { code: "41", nameAr: "سوق أهراس", nameFr: "Souk Ahras", cities: ["سوق أهراس"] },
  { code: "42", nameAr: "تيبازة", nameFr: "Tipaza", cities: ["تيبازة"] },
  { code: "43", nameAr: "ميلة", nameFr: "Mila", cities: ["ميلة"] },
  { code: "44", nameAr: "عين الدفلى", nameFr: "Aïn Defla", cities: ["عين الدفلى"] },
  { code: "45", nameAr: "النعامة", nameFr: "Naâma", cities: ["النعامة"] },
  { code: "46", nameAr: "عين تموشنت", nameFr: "Aïn Témouchent", cities: ["عين تموشنت"] },
  { code: "47", nameAr: "غرداية", nameFr: "Ghardaïa", cities: ["غرداية"] },
  { code: "48", nameAr: "غليزان", nameFr: "Relizane", cities: ["غليزان"] },
  { code: "49", nameAr: "تيميمون", nameFr: "Timimoun", cities: ["تيميمون"] },
  { code: "50", nameAr: "برج باجي مختار", nameFr: "Bordj Badji Mokhtar", cities: ["برج باجي مختار"] },
  { code: "51", nameAr: "أولاد جلال", nameFr: "Ouled Djellal", cities: ["أولاد جلال"] },
  { code: "52", nameAr: "بني عباس", nameFr: "Béni Abbès", cities: ["بني عباس"] },
  { code: "53", nameAr: "عين صالح", nameFr: "In Salah", cities: ["عين صالح"] },
  { code: "54", nameAr: "عين قزام", nameFr: "In Guezzam", cities: ["عين قزام"] },
  { code: "55", nameAr: "تقرت", nameFr: "Touggourt", cities: ["تقرت"] },
  { code: "56", nameAr: "جانت", nameFr: "Djanet", cities: ["جانت"] },
  { code: "57", nameAr: "المغير", nameFr: "El M'Ghair", cities: ["المغير"] },
  { code: "58", nameAr: "المنيعة", nameFr: "El Meniaa", cities: ["المنيعة"] },
];

const SPECIALTIES: { nameAr: string; nameFr: string; icon: string; description: string }[] = [
  { nameAr: "طب عام", nameFr: "Médecine générale", icon: "stethoscope", description: "الفحوصات العامة والاستشارات الأولية" },
  { nameAr: "طب الأطفال", nameFr: "Pédiatrie", icon: "baby", description: "متابعة صحة الرضع والأطفال" },
  { nameAr: "طب القلب", nameFr: "Cardiologie", icon: "heart-pulse", description: "أمراض القلب والشرايين" },
  { nameAr: "طب العيون", nameFr: "Ophtalmologie", icon: "eye", description: "فحص وعلاج أمراض العين" },
  { nameAr: "طب الأسنان", nameFr: "Dentisterie", icon: "tooth", description: "علاج وتقويم الأسنان" },
  { nameAr: "الأمراض الجلدية", nameFr: "Dermatologie", icon: "sparkles", description: "أمراض الجلد والشعر" },
  { nameAr: "طب النساء والتوليد", nameFr: "Gynécologie", icon: "flower", description: "متابعة الحمل وصحة المرأة" },
  { nameAr: "جراحة عامة", nameFr: "Chirurgie générale", icon: "scissors", description: "التدخلات الجراحية العامة" },
  { nameAr: "طب الأعصاب", nameFr: "Neurologie", icon: "brain", description: "أمراض الجهاز العصبي" },
  { nameAr: "الأنف والأذن والحنجرة", nameFr: "ORL", icon: "ear", description: "أمراض الأنف والأذن والحنجرة" },
];

const MALE_FIRST = ["محمد", "أحمد", "يوسف", "عبد الرحمن", "كريم", "سفيان", "إسلام", "بلال", "رياض", "طارق"];
const FEMALE_FIRST = ["أمينة", "سارة", "خديجة", "ياسمين", "نور الهدى", "فاطمة الزهراء", "إيمان", "مريم", "لينة", "هاجر"];
const LAST_NAMES = ["بن علي", "حمدي", "بوزيد", "شريف", "زيتوني", "عمراني", "بلحاج", "قاسمي", "مرابط", "طالبي", "بوعزة", "خليفي"];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

async function main() {
  console.log("🌱 بدء تعبئة قاعدة البيانات...");

  // ---- Wilayas & Cities ----
  const wilayaRecords: Record<string, { id: string; cityIds: string[] }> = {};
  for (const w of WILAYAS) {
    const wilaya = await prisma.wilaya.upsert({
      where: { code: w.code },
      update: {},
      create: { code: w.code, nameAr: w.nameAr, nameFr: w.nameFr },
    });
    const cityIds: string[] = [];
    // نستعمل القائمة الرسمية الكاملة لبلديات الولاية إن توفرت، وإلا نكتفي بالبلديات المذكورة أعلاه.
    const cityNames = ALL_COMMUNES[w.code]?.length ? ALL_COMMUNES[w.code] : w.cities;
    for (const cityName of cityNames) {
      const existing = await prisma.city.findFirst({ where: { nameAr: cityName, wilayaId: wilaya.id } });
      const city = existing ?? (await prisma.city.create({ data: { nameAr: cityName, wilayaId: wilaya.id } }));
      cityIds.push(city.id);
    }
    wilayaRecords[w.code] = { id: wilaya.id, cityIds };
  }
  console.log(`✔ ${WILAYAS.length} ولايات و${Object.values(wilayaRecords).reduce((n, w) => n + w.cityIds.length, 0)} بلديات`);

  // ---- Specialties ----
  const specialtyIds: string[] = [];
  for (const s of SPECIALTIES) {
    const sp = await prisma.specialty.upsert({
      where: { nameAr: s.nameAr },
      update: {},
      create: s,
    });
    specialtyIds.push(sp.id);
  }
  console.log(`✔ ${SPECIALTIES.length} تخصصات`);

  // ---- Medical services ----
  const serviceDefs = [
    { nameAr: "استشارة عامة", durationMin: 20, price: 2000 },
    { nameAr: "متابعة", durationMin: 15, price: 1500 },
    { nameAr: "فحص شامل", durationMin: 40, price: 3500 },
  ];
  const services = [];
  for (const s of serviceDefs) {
    services.push(await prisma.medicalService.create({ data: s }));
  }

  // ---- Clinics ----
  const clinicNames = ["عيادة النور", "مركز الشفاء الطبي", "عيادة الأمل", "المصحة الحديثة", "عيادة الصحة والعافية"];
  const clinics = [];
  const wilayaCodes = Object.keys(wilayaRecords);
  for (let i = 0; i < clinicNames.length; i++) {
    const wCode = pick(wilayaCodes, i);
    const w = wilayaRecords[wCode];
    const cityId = pick(w.cityIds, i);
    const clinic = await prisma.clinic.create({
      data: {
        nameAr: clinicNames[i],
        address: `شارع الاستقلال، رقم ${10 + i}`,
        phone: `0${5 + (i % 3)}${String(10000000 + i * 111111).slice(0, 8)}`,
        wilayaId: w.id,
        cityId,
      },
    });
    clinics.push(clinic);
  }
  console.log(`✔ ${clinics.length} عيادات`);

  // ---- Admin user ----
  const adminPassword = await bcrypt.hash("Admin@123", 10);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@medbook.dz" },
    update: {},
    create: {
      email: "admin@medbook.dz",
      phone: "0550000000",
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });
  console.log(`✔ حساب الإدارة: admin@medbook.dz / Admin@123`);

  // ---- Doctors (20) ----
  const doctorPassword = await bcrypt.hash("Doctor@123", 10);
  const languages = [["العربية", "الفرنسية"], ["العربية", "الإنجليزية"], ["العربية", "الفرنسية", "الإنجليزية"]];

  const createdDoctors = [];
  for (let i = 0; i < 20; i++) {
    const isFemale = i % 3 === 0;
    const firstName = isFemale ? pick(FEMALE_FIRST, i) : pick(MALE_FIRST, i);
    const lastName = pick(LAST_NAMES, i + 3);
    const email = `dr.${i + 1}@medbook.dz`;
    const specialtyId = pick(specialtyIds, i);
    const wCode = pick(wilayaCodes, i + 1);
    const w = wilayaRecords[wCode];
    const cityId = pick(w.cityIds, i + 2);
    const clinic = pick(clinics, i);

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        phone: `06${String(10000000 + i * 123456).slice(0, 8)}`,
        passwordHash: doctorPassword,
        role: Role.DOCTOR,
      },
    });

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        firstName,
        lastName,
        specialtyId,
        clinicId: clinic.id,
        wilayaId: w.id,
        cityId,
        bio: `طبيب ${isFemale ? "متخصصة" : "متخصص"} بخبرة ${4 + (i % 15)} سنوات، حاصل على شهادات معتمدة ومهتم براحة المرضى وجودة الرعاية الصحية.`,
        yearsExperience: 4 + (i % 15),
        languages: pick(languages, i),
        gender: isFemale ? Gender.FEMALE : Gender.MALE,
        phone: `023${String(100000 + i * 4321).slice(0, 6)}`,
        address: clinic.address,
        consultationFee: 1500 + (i % 5) * 500,
        verificationStatus: i % 7 === 0 ? VerificationStatus.PENDING : VerificationStatus.VERIFIED,
        avgRating: 0,
        reviewsCount: 0,
      },
    });
    createdDoctors.push(doctor);

    // Weekly schedule: Sun-Thu 08:00-12:00 & 14:00-17:00, Fri/Sat off
    const workDays = [0, 1, 2, 3, 4]; // Sunday..Thursday
    for (const day of workDays) {
      await prisma.doctorSchedule.createMany({
        data: [
          { doctorId: doctor.id, dayOfWeek: day, startTime: "08:00", endTime: "12:00" },
          { doctorId: doctor.id, dayOfWeek: day, startTime: "14:00", endTime: "17:00" },
        ],
      });
    }
  }
  console.log(`✔ ${createdDoctors.length} أطباء (بيانات دخول: dr.1@medbook.dz .. dr.20@medbook.dz / Doctor@123)`);

  // ---- Patients (10) ----
  const patientPassword = await bcrypt.hash("Patient@123", 10);
  const createdPatients = [];
  for (let i = 0; i < 10; i++) {
    const isFemale = i % 2 === 0;
    const firstName = isFemale ? pick(FEMALE_FIRST, i + 5) : pick(MALE_FIRST, i + 5);
    const lastName = pick(LAST_NAMES, i + 7);
    const email = `patient.${i + 1}@medbook.dz`;
    const wCode = pick(wilayaCodes, i);
    const cityId = pick(wilayaRecords[wCode].cityIds, i);

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        phone: `07${String(10000000 + i * 98765).slice(0, 8)}`,
        passwordHash: patientPassword,
        role: Role.PATIENT,
      },
    });
    const patient = await prisma.patient.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        firstName,
        lastName,
        birthDate: new Date(1985 + (i % 20), i % 12, (i % 27) + 1),
        gender: isFemale ? Gender.FEMALE : Gender.MALE,
        cityId,
      },
    });
    createdPatients.push(patient);
  }
  console.log(`✔ ${createdPatients.length} مرضى (بيانات دخول: patient.1@medbook.dz .. patient.10@medbook.dz / Patient@123)`);

  // ---- Appointments + Reviews ----
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let apptCount = 0;
  let reviewCount = 0;

  for (let i = 0; i < createdDoctors.length; i++) {
    const doctor = createdDoctors[i];
    const patient = createdPatients[i % createdPatients.length];

    // Past completed appointment (for review eligibility)
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - (7 + i));
    const pastAppt = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        date: pastDate,
        startTime: "09:00",
        endTime: "09:20",
        type: ConsultationType.IN_PERSON,
        status: AppointmentStatus.COMPLETED,
        notes: "استشارة متابعة",
      },
    });
    apptCount++;

    if (i % 2 === 0) {
      const rating = 3 + (i % 3);
      await prisma.review.create({
        data: {
          appointmentId: pastAppt.id,
          doctorId: doctor.id,
          patientId: patient.id,
          rating,
          comment: rating >= 4 ? "تجربة ممتازة وطبيب متعاون." : "تجربة جيدة بشكل عام.",
        },
      });
      reviewCount++;
    }

    // Upcoming pending/confirmed appointment
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + (1 + (i % 10)));
    // skip Friday(5)/Saturday(6)
    while ([5, 6].includes(futureDate.getDay())) {
      futureDate.setDate(futureDate.getDate() + 1);
    }
    const nextPatient = createdPatients[(i + 1) % createdPatients.length];
    await prisma.appointment.create({
      data: {
        patientId: nextPatient.id,
        doctorId: doctor.id,
        date: futureDate,
        startTime: "10:00",
        endTime: "10:20",
        type: ConsultationType.IN_PERSON,
        status: i % 4 === 0 ? AppointmentStatus.PENDING : AppointmentStatus.CONFIRMED,
        notes: null,
      },
    });
    apptCount++;
  }

  // Recalculate doctor rating aggregates
  for (const doctor of createdDoctors) {
    const agg = await prisma.review.aggregate({
      where: { doctorId: doctor.id },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        avgRating: agg._avg.rating ?? 0,
        reviewsCount: agg._count.rating,
      },
    });
  }

  console.log(`✔ ${apptCount} مواعيد، ${reviewCount} تقييمات`);
  console.log("🎉 اكتملت تعبئة قاعدة البيانات بنجاح.");
  console.log("---------------------------------------------");
  console.log("Admin:   admin@medbook.dz / Admin@123");
  console.log("Doctor:  dr.1@medbook.dz  / Doctor@123");
  console.log("Patient: patient.1@medbook.dz / Patient@123");
  console.log("---------------------------------------------");
}

main()
  .catch((e) => {
    console.error("❌ فشل التعبئة:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
