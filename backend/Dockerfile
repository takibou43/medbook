FROM node:22-alpine

WORKDIR /app

COPY prisma /app/prisma
COPY backend/package*.json /app/backend/
WORKDIR /app/backend
RUN npm ci

COPY backend /app/backend

RUN npx prisma generate --schema ../prisma/schema.prisma
RUN npm run build

# تشغيل بمستخدم غير جذري
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 4000

# لا seed هنا إطلاقًا: prisma/seed.ts ينشئ حسابات بكلمات مرور معروفة (للتطوير المحلي فقط).
# حساب الإدارة الأول يُنشأ عبر ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD عند الإقلاع.
CMD sh -c "npx prisma migrate deploy --schema ../prisma/schema.prisma && node dist/index.js"
