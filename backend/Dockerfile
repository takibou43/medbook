FROM node:20-alpine

WORKDIR /app

COPY prisma /app/prisma
COPY backend/package*.json /app/backend/
WORKDIR /app/backend
RUN npm install

COPY backend /app/backend

RUN npx prisma generate --schema ../prisma/schema.prisma
RUN npm run build

EXPOSE 4000

CMD sh -c "npx prisma migrate deploy --schema ../prisma/schema.prisma && npm run db:seed --if-present; node dist/index.js"
