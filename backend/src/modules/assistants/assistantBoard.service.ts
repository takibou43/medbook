import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { assistantDoctorWhere } from "../../lib/assistantScope";
import { assistantDoctorContext } from "../../lib/assistantDoctorContext";
import { ApiError } from "../../utils/ApiError";
import { getQueueForDoctor, listForDoctor } from "../appointments/appointments.service";

export async function assignedDoctors(userId: string) {
  const assistant = await prisma.assistant.findUnique({ where: { userId }, include: { doctor: { select: { user: { select: { isActive: true } } } } } });
  if (!assistant?.isActive || (!assistant.clinicId && !assistant.doctor.user.isActive)) throw ApiError.forbidden();
  return prisma.doctor.findMany({ where: assistantDoctorWhere(assistant), select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] });
}

// Each asynchronous branch gets its own doctor context; the client's old selection
// cannot restrict the board or leak another doctor's appointments.
export async function assistantQueues(userId: string) {
  const doctors = await assignedDoctors(userId);
  return Promise.all(doctors.map(doctor => assistantDoctorContext.run(doctor.id, async () => ({
    doctor, queue: await getQueueForDoctor(userId, Role.ASSISTANT),
  }))));
}

export async function assistantAppointments(userId: string, date: string) {
  const doctors = await assignedDoctors(userId);
  const groups = await Promise.all(doctors.map(doctor => assistantDoctorContext.run(doctor.id, async () =>
    (await listForDoctor(userId, Role.ASSISTANT, undefined, date)).map(appointment => ({ ...appointment, doctor }))
  )));
  return groups.flat().sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}
