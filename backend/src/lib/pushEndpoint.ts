import { z } from "zod";

// Only browser push providers may receive server-side requests. Never accept an
// arbitrary HTTPS URL: authenticated clients can otherwise reach internal hosts.
const PROVIDERS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);
export function isTrustedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash &&
      (PROVIDERS.has(u.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}

export const pushEndpointSchema = z.string().url().max(2048).refine(isTrustedPushEndpoint, "عنوان اشتراك غير صالح");
const b64url = /^[A-Za-z0-9_-]+=*$/;
export const safePushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(b64url, "مفتاح غير صالح"),
    auth: z.string().min(8).max(128).regex(b64url, "مفتاح غير صالح"),
  }),
});
