export function cameraErrorMessage(error: unknown): string {
 const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
 if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'السماح بالكاميرا مطلوب. افتح إعدادات الموقع في المتصفح واسمح بالكاميرا، ثم أعد المحاولة.';
 if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'لم يتم العثور على كاميرا في هذا الجهاز. يمكنك تسجيل الحضور لدى المساعد.';
 if (name === 'NotReadableError' || name === 'TrackStartError') return 'الكاميرا مشغولة أو غير متاحة. أغلق التطبيقات التي تستخدمها ثم أعد المحاولة.';
 return 'تعذر تشغيل الكاميرا. افتح مادبوك في Chrome أو Safari واسمح بالكاميرا، ثم أعد المحاولة.';
}
