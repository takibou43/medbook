export type AnnouncedDoctor = {
  id: string;
  // حساب الطبيب نفسه: يُستثنى من إعلان «طبيب جديد في ولايتك» إن كان يحمل ملف مريض أيضًا.
  userId?: string;
  firstName: string;
  lastName: string;
  wilayaId: string;
  city: { nameAr: string };
  specialty: { nameAr: string };
  clinic?: { nameAr: string } | null;
};

export function newDoctorAnnouncement(doctor: AnnouncedDoctor) {
  return {
    title: doctor.clinic ? "طبيب جديد تابع لعيادة في ولايتك" : "طبيب جديد في ولايتك",
    message: doctor.clinic
      ? `انضم د. ${doctor.firstName} ${doctor.lastName}، ${doctor.specialty.nameAr}، إلى عيادة ${doctor.clinic.nameAr} في ${doctor.city.nameAr}. يمكنك الآن الحجز لديه عبر MedBook.`
      : `انضم د. ${doctor.firstName} ${doctor.lastName}، ${doctor.specialty.nameAr} في ${doctor.city.nameAr}، إلى MedBook.`,
    pushBody: doctor.clinic
      ? `طبيب جديد تابع لعيادة ${doctor.clinic.nameAr} في ولايتك. افتح التطبيق للاطلاع عليه.`
      : "انضم طبيب جديد إلى MedBook في ولايتك. افتح التطبيق للاطلاع عليه.",
  };
}
