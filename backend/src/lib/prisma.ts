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
    // Prisma error events can contain query arguments; errorHandler logs safe codes.
    log: ["warn"],
  });

if (!env.isProd) global.__prisma = prisma;
