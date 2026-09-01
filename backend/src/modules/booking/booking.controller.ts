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

export const createGuestBooking = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await service.createGuestAppointment(req.body);
  res.status(201).json({ success: true, data: appointment });
});
