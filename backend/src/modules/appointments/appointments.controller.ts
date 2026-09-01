import { Request, Response } from "express";
import { AppointmentStatus } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./appointments.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await service.createAppointment(req.user!.id, req.body);
  res.status(201).json({ success: true, data: appointment });
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as AppointmentStatus | undefined;
  const role = req.user!.role;
  const data =
    role === "DOCTOR"
      ? await service.listForDoctor(req.user!.id, status, req.query.date as string | undefined)
      : await service.listForPatient(req.user!.id, status);
  res.json({ success: true, data });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await service.updateStatus(req.user!.id, req.user!.role, req.params.id, req.body.status);
  res.json({ success: true, data: updated });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const updated = await service.cancelByPatient(req.user!.id, req.params.id);
  res.json({ success: true, data: updated });
});
