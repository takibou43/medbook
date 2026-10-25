FROM node:22-alpine

RUN apk add --no-cache openssl postgresql-client
WORKDIR /app

COPY prisma /app/prisma
COPY backend/package*.json /app/backend/
WORKDIR /app/backend
RUN npm ci

COPY backend /app/backend

RUN npx prisma generate --schema ../prisma/schema.prisma
RUN npm run build

ENV NODE_ENV=production
USER node
EXPOSE 4000

CMD ["sh", "docker-entrypoint.sh"]
