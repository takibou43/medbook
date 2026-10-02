import { Request, Response } from "express";
import { AppointmentStatus } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./appointments.service";
import { redactDoctorSecrets } from "../../lib/redact";
import { ApiError } from "../../utils/ApiError";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await service.createAppointment(req.user!.id, req.body);
  res.status(201).json({ success: true, data: redactDoctorSecrets(appointment) });
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayParam(value: unknown, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !DAY_RE.test(value) || isNaN(new Date(value + "T00:00:00Z").getTime()) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
    throw ApiError.badRequest(`صيغة ${name} يجب أن تكون YYYY-MM-DD.`);
  }
  return value;
}

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as AppointmentStatus | undefined;
  const role = req.user!.role;
  const data =
    role === "DOCTOR" || role === "ASSISTANT"
      ? await service.listForDoctor(req.user!.id, role, status, dayParam(req.query.date, "date"), {
          from: dayParam(req.query.from, "from"),
          to: dayParam(req.query.to, "to"),
        })
      : await service.listForPatient(req.user!.id, status);
  res.json({ success: true, data: redactDoctorSecrets(data) });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await service.updateStatus(req.user!.id, req.user!.role, req.params.id, req.body.status);
  res.json({ success: true, data: redactDoctorSecrets(updated) });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const updated = await service.cancelByPatient(req.user!.id, req.params.id);
  res.json({ success: true, data: redactDoctorSecrets(updated) });
});

// ---- طابور العيادة اليومي (للطبيب فقط) ----

export const queue = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.getQueueForDoctor(req.user!.id, req.user!.role);
  res.json({ success: true, data });
});

export const callNext = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.callNextPatient(req.user!.id, req.user!.role);
  res.json({ success: true, data });
});

export const markLate = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.markAsLate(req.user!.id, req.params.id, req.user!.role);
  res.json({ success: true, data });
});

export const callPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.callSpecificPatient(req.user!.id, req.params.id, req.user!.role);
  res.json({ success: true, data });
});

export const markArrived = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.markPatientArrived(req.user!.id, req.params.id, req.user!.role);
  res.json({ success: true, data });
});
