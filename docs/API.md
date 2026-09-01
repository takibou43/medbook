# MedBook API — مرجع المسارات

القاعدة: `http://localhost:4000/api`
كل الاستجابات بصيغة: `{ success: boolean, data?: any, message?: string, errors?: [...] }`
المصادقة: هيدر `Authorization: Bearer <accessToken>` (يُستخرج تلقائيًا من `/auth/login` أو `/auth/register/*`؛ التجديد عبر cookie `medbook_refresh` على `POST /auth/refresh`).

## Auth
| Method | Path | صلاحية | وصف |
|---|---|---|---|
| POST | /auth/register/patient | عام | تسجيل مريض جديد |
| POST | /auth/register/doctor | عام | تسجيل طبيب جديد (يبقى PENDING حتى توثيق الإدارة) |
| POST | /auth/login | عام | تسجيل الدخول |
| POST | /auth/refresh | عام (cookie) | تجديد Access Token |
| POST | /auth/logout | عام | تسجيل الخروج |
| GET | /auth/me | مصادق | بيانات المستخدم الحالي |

## Catalog (عام)
| GET | /specialties | قائمة التخصصات |
| GET | /wilayas | الولايات مع البلديات |
| GET | /wilayas/:id/cities | بلديات ولاية محددة |

## Doctors (عام)
| GET | /doctors?specialtyId=&wilayaId=&cityId=&gender=&q=&minRating=&page=&pageSize= | بحث/فلترة |
| GET | /doctors/:id | ملف طبيب كامل + تقييمات |
| GET | /doctors/:id/availability?date=YYYY-MM-DD | الفترات المتاحة في تاريخ محدد |

## Doctor (self — دور DOCTOR فقط)
| GET/PATCH | /doctor/profile | عرض/تعديل الملف المهني |
| GET/PUT | /doctor/schedule | الجدول الأسبوعي |
| POST | /doctor/schedule/exceptions | إضافة إجازة/استثناء |
| DELETE | /doctor/schedule/:blockId | حذف فترة/استثناء |
| GET | /doctor/dashboard | إحصائيات لوحة الطبيب |
| GET | /doctor/patients | قائمة المرضى |

## Patient (self — دور PATIENT فقط)
| GET/PATCH | /patient/profile | عرض/تعديل الملف الشخصي |
| GET | /patient/appointments | مواعيد المريض |
| GET | /patient/dashboard | إحصائيات لوحة المريض |

## Appointments (مصادق)
| POST | /appointments | حجز موعد (PATIENT) |
| GET | /appointments?status=&date= | مواعيدي (حسب الدور) |
| PATCH | /appointments/:id | تغيير الحالة `{status}` (حسب صلاحيات الدور) |
| DELETE | /appointments/:id | إلغاء موعد (PATIENT) |

## Reviews
| POST | /reviews | تقييم `{appointmentId, rating, comment?}` (PATIENT، بعد موعد COMPLETED فقط) |
| GET | /reviews/doctor/:doctorId | تقييمات طبيب |

## Notifications (مصادق)
| GET | /notifications?unread=true | قائمة الإشعارات |
| PATCH | /notifications/:id/read | تعليم كمقروء |
| PATCH | /notifications/read-all | تعليم الكل كمقروء |

## Favorites (PATIENT)
| GET | /favorites |
| POST /DELETE | /favorites/:doctorId |

## Admin (دور ADMIN فقط)
| GET | /admin/stats | إحصائيات عامة |
| GET/POST/PATCH/DELETE | /admin/users | إدارة المستخدمين |
| GET | /admin/doctors | قائمة الأطباء |
| PATCH | /admin/doctors/:id/verify | `{status: PENDING\|VERIFIED\|REJECTED}` |
| PATCH | /admin/doctors/:id | تعديل بيانات طبيب |
| GET/POST/PATCH/DELETE | /admin/specialties | CRUD التخصصات |
| GET/POST/PATCH/DELETE | /admin/wilayas | CRUD الولايات |
| POST/DELETE | /admin/wilayas/:id/cities , /admin/cities/:id | CRUD البلديات |
| GET/DELETE | /admin/reviews | إشراف على التقييمات |

## رموز الأخطاء الشائعة
- `400` بيانات غير صالحة / مخالفة قاعدة عمل (مثال: حجز في وقت مضى)
- `401` غير مصادق / جلسة منتهية
- `403` غير مصرح (صلاحية الدور)
- `404` غير موجود
- `409` تعارض (مثال: **حجز مزدوج على نفس الفترة**، بريد إلكتروني مستخدم)
