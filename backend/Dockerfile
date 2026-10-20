FROM node:22-alpine

WORKDIR /app

COPY prisma /app/prisma
COPY backend/package*.json /app/backend/
WORKDIR /app/backend
# npm ci: تثبيت مطابق للـlockfile تمامًا (npm install قد يرفع الإصدارات ويكسر إعادة الإنتاج).
RUN npm ci

COPY backend /app/backend

RUN npx prisma generate --schema ../prisma/schema.prisma
RUN npm run build

# لا يعمل الخادم بصلاحية root: اختراق التطبيق لا يمنح صلاحيات الحاوية الكاملة.
RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD sh -c "npx prisma migrate deploy --schema ../prisma/schema.prisma && exec node dist/index.js"
