import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const h = vi.hoisted(() => {
  const rows: any[] = [];
  const match = (s: any, w: any) => (!w.id || s.id === w.id) && (!w.userId || s.userId === w.userId) && (!w.tokenHash || s.tokenHash === w.tokenHash) && (w.revoked === undefined || s.revoked === w.revoked) && (!w.expiresAt || s.expiresAt > w.expiresAt.gt);
  const db: any = {
    refreshToken: {
      findFirst: vi.fn(async ({ where }: any) => rows.find(s => match(s, where)) ?? null),
      updateMany: vi.fn(async ({ where }: any) => { const selected = rows.filter(s => match(s, where)); selected.forEach(s => { s.revoked = true; }); return { count: selected.length }; }),
    },
    user: { findUnique: vi.fn(async () => ({ id: 'patient', role: 'PATIENT', isActive: true })) },
    favorite: { findMany: vi.fn(async () => [{ id: 'favorite', doctor: { id: 'doctor', firstName: 'طبيب', userId: 'internal', clinicManagerForId: 'clinic', clinicPermissions: ['VIEW_FINANCE'], subscriptionStatus: 'ACTIVE', referralCode: 'private', futureSecret: 'hidden', clinic: { id: 'clinic', nameAr: 'عيادة', ownerId: 'owner', futureSecret: 'hidden' } } }]) },
    appointment: { count: vi.fn(async () => 0), create: vi.fn(async (args: any) => ({ id: 'new', ...args.data })) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { db, rows };
});
vi.mock('../src/lib/prisma', () => ({ prisma: h.db }));
import { hashToken } from '../src/lib/tokens';
import { logout } from '../src/modules/auth/auth.service';
import { logoutPatient } from '../src/modules/patientAuth/patientAuth.service';
import { redactForRole } from '../src/lib/redact';
import { signArrivalCode, verifyArrivalCode } from '../src/lib/arrivalCode';
import { arrivalInput, scanArrival } from '../src/modules/appointments/arrival.service';
import { createPatientAppointment } from '../src/lib/patientBooking';
import favoriteRouter from '../src/modules/favorites/favorites.routes';
import { signAccessToken } from '../src/utils/jwt';
import { errorHandler } from '../src/middleware/errorHandler';

beforeEach(() => { vi.clearAllMocks(); h.rows.length = 0; h.db.appointment.count.mockResolvedValue(0); });

describe('security release regression', () => {
  it.each([logout, logoutPatient])('stale cookies cannot revoke current sessions', async fn => {
    for (const stale of [{ revoked: true, expiresAt: new Date('2099-01-01') }, { revoked: false, expiresAt: new Date(0) }]) {
      h.rows.splice(0, h.rows.length, { id: 'old', userId: 'victim', tokenHash: hashToken('old'), ...stale }, { id: 'new', userId: 'victim', tokenHash: hashToken('new'), revoked: false, expiresAt: new Date('2099-01-01') });
      await fn('old', true);
      expect(h.rows[1].revoked).toBe(false);
    }
  });
  it.each([logout, logoutPatient])('current cookie revokes only its own account sessions', async fn => {
    h.rows.push({ id: 's', userId: 'victim', tokenHash: hashToken('current'), revoked: false, expiresAt: new Date('2099-01-01') }, { id: 's2', userId: 'victim', tokenHash: hashToken('other'), revoked: false, expiresAt: new Date('2099-01-01') }, { id: 'foreign', userId: 'someone-else', revoked: false, expiresAt: new Date('2099-01-01') });
    await fn('current', true);
    expect(h.rows.map(s => s.revoked)).toEqual([true, true, false]);
  });
  it('patient favorites HTTP cannot expose current or future internal fields', async () => {
    const app = express(); app.use('/favorites', favoriteRouter); app.use(errorHandler);
    const r = await request(app).get('/favorites').set('Authorization', 'Bearer ' + signAccessToken({ sub: 'patient', role: 'PATIENT' }));
    expect(r.status).toBe(200);
    expect(r.body.data[0].doctor).toEqual({ id: 'doctor', firstName: 'طبيب', clinic: { id: 'clinic', nameAr: 'عيادة' } });
    expect(h.db.favorite.findMany.mock.calls[0][0].include.doctor).toHaveProperty('select');
  });
  it('patient projection preserves visit identity and price; staff retain internal context', () => {
    const appointment = { id: 'a', patientId: 'p', familyMemberId: 'f', priceDzd: 1700, doctor: { id: 'd', userId: 'u', consultationFee: 1700, subscriptionStatus: 'ACTIVE', clinic: { nameAr: 'عيادة', ownerId: 'owner' } } };
    expect(redactForRole(appointment, 'PATIENT')).toEqual({ id: 'a', patientId: 'p', familyMemberId: 'f', priceDzd: 1700, doctor: { id: 'd', consultationFee: 1700, clinic: { nameAr: 'عيادة' } } });
    for (const role of ['DOCTOR','ASSISTANT','ADMIN']) expect(redactForRole(appointment, role)).toEqual(appointment);
  });
  it('public UUID, wrong scope and modified signatures cannot authorize arrival', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const code = signArrivalCode('doctor', id);
    expect(verifyArrivalCode(code)).toEqual({ kind: 'doctor', id });
    for (const value of ['medbook-arrival:v1:doctor:' + id, code.replace(':doctor:', ':clinic:'), code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')]) {
      expect(arrivalInput.safeParse({ code: value }).success).toBe(false);
      await expect(scanArrival('patient', { code: value })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it('fourth active patient booking is refused before insert and beneficiary is isolated', async () => {
    h.db.appointment.count.mockResolvedValue(3);
    await expect(createPatientAppointment(h.db, { data: { patientId: 'p', familyMemberId: 'f', doctorId: 'd', date: new Date('2099-01-01'), startTime: '08:00', endTime: '08:20', createdBy: 'PATIENT' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(h.db.appointment.create).not.toHaveBeenCalled();
    expect(h.db.appointment.count.mock.calls[0][0].where).toMatchObject({ patientId: 'p', familyMemberId: 'f', doctorId: 'd', createdBy: 'PATIENT' });
    expect(h.db.$executeRaw).toHaveBeenCalledOnce();
  });
  it('third appointment succeeds and physician follow-ups do not consume patient quota', async () => {
    h.db.appointment.count.mockResolvedValue(2);
    const data = { patientId: 'p', doctorId: 'd', date: new Date('2099-01-01'), startTime: '08:00', endTime: '08:20', createdBy: 'PATIENT' as const };
    expect(await createPatientAppointment(h.db, { data })).toHaveProperty('id', 'new');
    h.db.appointment.count.mockClear();
    expect(await createPatientAppointment(h.db, { data: { ...data, createdBy: 'DOCTOR' } })).toHaveProperty('id', 'new');
    expect(h.db.appointment.count).not.toHaveBeenCalled();
  });
});
