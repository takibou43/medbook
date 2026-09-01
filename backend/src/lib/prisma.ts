import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// Avoid exhausting DB connections with hot-reload in dev
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.isProd ? ["error", "warn"] : ["error", "warn"],
  });

if (!env.isProd) global.__prisma = prisma;
