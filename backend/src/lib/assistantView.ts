/**
 * الحقول الآمنة التي يجوز أن تصل إلى جلسة المساعد ضمن `user.assistant.doctor` — سواء عند
 * تسجيل الدخول لأول مرة (قبول الدعوة، acceptInvite) أو عند GET /api/auth/me لاحقًا (getMe).
 *
 * `select` صريح لا `include`، وإلا يُرجع Prisma افتراضيًا كل حقول Doctor القياسية بما فيها
 * consultationFee وsubscriptionStatus وsubscriptionExpiresAt وغيرها من البيانات المالية/
 * الإدارية التي لا يجوز أن تصل إلى المساعد أصلًا (حتى لو لم تُعرض في الواجهة). أي حقل جديد
 * يُضاف مستقبلًا إلى Doctor يبقى مستبعدًا هنا تلقائيًا ما لم يُدرَج صراحة أدناه.
 *
 * ثابت واحد مُستخدم في مكانين (auth.service.getMe وassistants.service.acceptInvite) حتى لا
 * يُنسى تحديث أحدهما عند الآخر ويتكرر نفس الخطأ.
 */
export const ASSISTANT_SAFE_SELECT = {
  select: {
    id: true,
    isActive: true,
    doctor: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        verificationStatus: true,
        specialty: { select: { nameAr: true } },
        wilaya: { select: { nameAr: true } },
        city: { select: { nameAr: true } },
        clinic: { select: { nameAr: true, address: true } },
      },
    },
  },
};
