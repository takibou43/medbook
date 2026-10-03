import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { ApiError } from "./ApiError";

const SALT_ROUNDS = 10;
const LONG_PASSWORD_PREFIX = "medbook-sha384-v1:";

function digestPassword(plain: string): string {
  return createHash("sha384").update("medbook-password-v1\0").update(plain, "utf8").digest("base64");
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length > 128) throw ApiError.badRequest("كلمة المرور طويلة جدًا (الحد 128 خانة).");
  // bcrypt consumes only 72 bytes. A versioned digest preserves the complete
  // UTF-8 password while keeping existing bcrypt hashes compatible.
  if (Buffer.byteLength(plain, "utf8") > 72) {
    return LONG_PASSWORD_PREFIX + await bcrypt.hash(digestPassword(plain), SALT_ROUNDS);
  }
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  // Bound legacy inputs too, before bcrypt's UTF-8 conversion.
  if (plain.length > 4096) return Promise.resolve(false);
  if (hash.startsWith(LONG_PASSWORD_PREFIX)) {
    return bcrypt.compare(digestPassword(plain), hash.slice(LONG_PASSWORD_PREFIX.length));
  }
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  return dummyHash ??= hashPassword("medbook-timing-equalizer-not-a-real-password");
}
