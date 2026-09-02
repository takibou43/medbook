import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as service from "./booking.service";

export const getSlots = asyncHandler(async (req: Request, res: Response) => {
  const slots = await service.getAggregatedSlots({
    wilayaId: req.query.wilayaId as string,
    specialtyId: req.query.specialtyId as string,
    date: req.query.date as string,
  });
  res.json({ success: true, data: { slots } });
});

// معاينة الدور الذي سيمنحه النظام للمريض قبل أن يؤكد الحجز.
export const getNextSlot = asyncHandler(async (req: Request, res: Response) => {
  const data = await service.previewNextSlot(req.query.doctorId as string);
  res.json({ success: true, data });
});

export const createGuestBooking = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await service.createGuestAppointment(req.body);
  res.status(201).json({ success: true, data: appointment });
});

export const lookupBookings = asyncHandler(async (req: Request, res: Response) => {
  const appointments = await service.lookupAppointmentsByPhone(req.query.phone as string);
  res.json({ success: true, data: appointments });
});

export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await service.cancelGuestAppointment(req.params.id, req.body.phone);
  res.json({ success: true, data: appointment });
});
