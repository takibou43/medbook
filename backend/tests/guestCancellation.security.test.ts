import { beforeEach, expect, it, vi } from "vitest";
import { AppointmentStatus, Prisma } from "@prisma/client";

const h = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma: { appointment: h } }));
import { cancelGuestAppointment } from "../src/modules/booking/booking.service";

const phone = "0550000000";
const guest = { id: "synthetic-guest", patientId: null, guestPhone: phone, status: AppointmentStatus.CONFIRMED };
beforeEach(() => {
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue({ ...guest });
  h.update.mockResolvedValue({ ...guest, status: AppointmentStatus.CANCELLED, doctor: {} });
});

it.each(["NO_SHOW", "COMPLETED", "IN_PROGRESS", "LATE", "CANCELLED"] as AppointmentStatus[])(
  "rejects public cancellation of %s without changing the record", async status => {
    h.findUnique.mockResolvedValue({ ...guest, status });
    await expect(cancelGuestAppointment(guest.id, phone)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.update).not.toHaveBeenCalled();
  }
);

it.each(["PENDING", "CONFIRMED", "RESCHEDULE_REQUIRED"] as AppointmentStatus[])(
  "preserves legitimate %s cancellation and slot release", async status => {
    h.findUnique.mockResolvedValue({ ...guest, status });
    const result = await cancelGuestAppointment(guest.id, phone);
    expect(result.status).toBe("CANCELLED");
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: guest.id, patientId: null, guestPhone: phone, status },
      data: expect.objectContaining({ status: "CANCELLED", activeSlot: null }),
    }));
    expect(result).not.toHaveProperty("guestPhone");
  }
);

it.each([null, { ...guest, patientId: "another-patient" }, { ...guest, guestPhone: "0559999999" }])(
  "rejects nonexistent, registered and nonmatching guest records", async row => {
    h.findUnique.mockResolvedValue(row);
    await expect(cancelGuestAppointment(guest.id, phone)).rejects.toMatchObject({ statusCode: 404 });
    expect(h.update).not.toHaveBeenCalled();
  }
);

it("returns 409 if a concurrent staff update changes the status before cancellation", async () => {
  h.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2025", clientVersion: "5.22.0" }));
  await expect(cancelGuestAppointment(guest.id, phone)).rejects.toMatchObject({ statusCode: 409 });
});

it("does not disguise database failures as status conflicts", async () => {
  h.update.mockRejectedValue(new Error("synthetic database failure"));
  await expect(cancelGuestAppointment(guest.id, phone)).rejects.toThrow("synthetic database failure");
});
