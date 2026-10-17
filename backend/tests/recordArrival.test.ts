import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/queueNotified', () => ({ withNearTurnFlags: vi.fn(async (_tx, rows) => rows) }));
import { recordArrival } from '../src/lib/recordArrival';
describe('shared arrival writer', () => {
 it('does not rewrite an existing arrival or audit it twice', async () => {
  const tx = { appointment: { update: vi.fn() }, auditLog: { create: vi.fn() } };
  const arrivedAt = new Date();
  expect(await recordArrival(tx as any, { id: 'a', doctorId: 'd', arrivedAt, isFollowUp: false }, 'u')).toBe(arrivedAt);
  expect(tx.appointment.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
 });
 it('writes only attendance fields, preserving beneficiary and visit identity', async () => {
  const tx = { appointment: { update: vi.fn() }, auditLog: { create: vi.fn() } };
  await recordArrival(tx as any, { id: 'a', doctorId: 'd', arrivedAt: null, isFollowUp: false }, 'u');
  expect(tx.appointment.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { arrivedAt: expect.any(Date), skipCredits: 0 } });
  expect(tx.auditLog.create).toHaveBeenCalledOnce();
 });
});
