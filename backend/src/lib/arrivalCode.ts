import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

const CODE = /^medbook-arrival:v2:(clinic|doctor):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{64})$/;
const tag = (payload: string) => createHmac('sha256', env.jwtRefreshSecret).update('medbook-arrival-poster\0' + payload).digest('hex');

/** Printed capability: public UUIDs alone must never authorize attendance. */
export function signArrivalCode(kind: 'clinic' | 'doctor', id: string): string {
  const payload = `medbook-arrival:v2:${kind}:${id.toLowerCase()}`;
  return payload + ':' + tag(payload);
}

export function verifyArrivalCode(code: string): { kind: 'clinic' | 'doctor'; id: string } | null {
  const match = CODE.exec(code);
  if (!match) return null;
  const payload = code.slice(0, code.lastIndexOf(':'));
  if (!timingSafeEqual(Buffer.from(match[3], 'hex'), Buffer.from(tag(payload), 'hex'))) return null;
  return { kind: match[1] as 'clinic' | 'doctor', id: match[2] };
}
