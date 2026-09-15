// تسمية مختصرة وودّية لأقرب دور ("اليوم 16:30"، "غدًا 09:00"، أو التاريخ الكامل) —
// نفس منطق BookAppointment.tsx، مستخرج هنا حتى تعرضه بطاقة/ملف الطبيب أيضًا بلا تكرار.
export function formatSlotLabel(dateStr: string, startTime: string): string {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return `اليوم ${startTime}`;
  if (diffDays === 1) return `غدًا ${startTime}`;
  return `${target.toLocaleDateString("ar-DZ", { weekday: "long", day: "numeric", month: "long" })} — ${startTime}`;
}
