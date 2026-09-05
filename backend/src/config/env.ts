import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // Fail fast and loudly rather than booting with a broken config.
    throw new Error(`متغير البيئة المطلوب مفقود: ${name}. راجع ملف .env.example`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  // CLIENT_URL يدعم أكثر من نطاق مفصولة بفاصلة (موقع المرضى + موقع الأطباء المنفصل)
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  clientUrls: (process.env.CLIENT_URL ?? "http://localhost:5173")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean),

  databaseUrl: required("DATABASE_URL"),

  jwtSecret: required("JWT_SECRET", "dev_secret_change_me"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev_refresh_secret_change_me"),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? "15m",
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES ?? "7d",

  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 200),

  ai: {
    provider: (process.env.AI_PROVIDER ?? "mock") as "mock" | "anthropic" | "openai",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
  },

  // إعدادات مزوّد SMS (BudgetSMS) للتذكير التلقائي بالمواعيد — انظر backend/src/lib/sms.ts.
  // تُترك فارغة افتراضيًا؛ في هذه الحالة sendSms تسجّل الرسالة في السجلات فقط دون إرسال فعلي.
  sms: {
    budgetsmsUsername: process.env.BUDGETSMS_USERNAME ?? "",
    budgetsmsUserId: process.env.BUDGETSMS_USERID ?? "",
    budgetsmsHandle: process.env.BUDGETSMS_HANDLE ?? "",
    senderId: process.env.SMS_SENDER_ID ?? "MedBook",
  },

  isProd: (process.env.NODE_ENV ?? "development") === "production",
};
