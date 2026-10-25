import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  const state = { invite: {} as any, doctor: {} as any };
  const db: any = {
    assistantInvite: {
      findUnique: vi.fn(async () => ({ ...state.invite })),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.invite;
        if ((where.status !== undefined && row.status !== where.status) || (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash)) {
          throw new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code: "P2025", clientVersion: "test" });
        }
        return Object.assign(row, data);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.invite;
        if (row.id !== where.id || row.tokenHash !== where.tokenHash || row.status !== where.status || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    doctor: {
      findUnique: vi.fn(async () => ({ ...state.doctor })),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.doctor })),
      findMany: vi.fn(async () => [{ id: "inviter" }, { id: "colleague" }]),
      count: vi.fn(async () => 1),
    },
    user: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "new-assistant", ...data })),
    },
    refreshToken: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 1),
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { state, db, hashPassword: vi.fn(async () => "synthetic-hash") };
});
vi.mock("../src/lib/prisma", () => ({ prisma: h.db }));
vi.mock("../src/utils/password", () => ({ hashPassword: h.hashPassword }));

import { acceptInvite, resendInvite, revokeInvite } from "../src/modules/assistants/assistants.service";
import { hashToken } from "../src/lib/tokens";
import authRoutes from "../src/modules/auth/auth.routes";
import { errorHandler } from "../src/middleware/errorHandler";

const app = express();
app.use(express.json());
app.use("/auth", authRoutes);
app.use(errorHandler);

const token = "synthetic-invite-token";
const input = { password: "Synthetic@123", firstName: "Test", lastName: "Assistant" };

beforeEach(() => {
  vi.clearAllMocks();
  h.state.invite = { id: "invite", tokenHash: hashToken(token), doctorId: "inviter", clinicId: null, allDoctors: true, allowedDoctorIds: [], email: "assistant@example.test", status: "PENDING", expiresAt: new Date(Date.now() + 60000) };
  h.state.doctor = { id: "inviter", clinicId: null };
  h.hashPassword.mockResolvedValue("synthetic-hash");
});

describe("assistant invitation authorization at acceptance", () => {
  it("does not upgrade an independent invite to access every doctor of a newly joined clinic", async () => {
    h.state.doctor.clinicId = "new-clinic";
    await expect(acceptInvite(token, input)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it.each(["other-clinic", null])("rejects a clinic invite after the doctor moves to %s", async clinicId => {
    h.state.invite.clinicId = "original-clinic";
    h.state.doctor.clinicId = clinicId;
    await expect(acceptInvite(token, input)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it.each(["REVOKED", "ACCEPTED"])("does not overwrite a concurrently %s invitation", async status => {
    h.hashPassword.mockImplementationOnce(async () => {
      h.state.invite.status = status;
      return "synthetic-hash";
    });
    await expect(acceptInvite(token, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.state.invite.status).toBe(status);
  });

  it("rejects an old token replaced during password hashing", async () => {
    h.hashPassword.mockImplementationOnce(async () => {
      h.state.invite.tokenHash = hashToken("replacement-token");
      return "synthetic-hash";
    });
    await expect(acceptInvite(token, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it("rejects an invitation that expires during acceptance", async () => {
    h.hashPassword.mockImplementationOnce(async () => {
      h.state.invite.expiresAt = new Date(0);
      return "synthetic-hash";
    });
    await expect(acceptInvite(token, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it.each([null, "same-clinic"])("preserves valid invitation scope for %s", async clinicId => {
    h.state.invite.clinicId = clinicId;
    h.state.doctor.clinicId = clinicId;
    const user = await acceptInvite(token, input);
    expect(user.assistant.create).toMatchObject({ doctorId: "inviter", clinicId, allDoctors: true, allowedDoctorIds: [] });
    expect(h.state.invite.status).toBe("ACCEPTED");
    expect(h.db.user.create).toHaveBeenCalledOnce();
  });

  it("preserves an owner's explicitly restricted doctor assignment", async () => {
    Object.assign(h.state.invite, { clinicId: "same-clinic", allDoctors: false, allowedDoctorIds: ["colleague"] });
    h.state.doctor.clinicId = "same-clinic";
    const user = await acceptInvite(token, input);
    expect(user.assistant.create).toMatchObject({ clinicId: "same-clinic", allDoctors: false, allowedDoctorIds: ["colleague"] });
  });

  it.each([resendInvite, revokeInvite])("does not let stale management requests overwrite an accepted invite", async change => {
    h.db.assistantInvite.findUnique.mockImplementationOnce(async () => {
      const snapshot = { ...h.state.invite };
      h.state.invite.status = "ACCEPTED";
      return snapshot;
    });
    await expect(change("doctor-user", "invite")).rejects.toMatchObject({ statusCode: 409 });
    expect(h.state.invite.status).toBe("ACCEPTED");
    expect(h.state.invite.tokenHash).toBe(hashToken(token));
  });

  it("still permits normal revocation and resend", async () => {
    await revokeInvite("doctor-user", "invite");
    expect(h.state.invite.status).toBe("REVOKED");
    const replacement = await resendInvite("doctor-user", "invite");
    expect(h.state.invite.status).toBe("PENDING");
    expect(h.state.invite.tokenHash).toBe(hashToken(replacement.rawToken));
  });

  it("blocks escalation through the public HTTP registration endpoint without issuing a session", async () => {
    h.state.doctor.clinicId = "new-clinic";
    const r = await request(app).post("/auth/register/assistant").send({ token, ...input });
    expect(r.status).toBe(403);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(r.body.data?.accessToken).toBeUndefined();
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.refreshToken.create).not.toHaveBeenCalled();
  });

  it("keeps legitimate HTTP registration working and does not expose the password hash", async () => {
    const r = await request(app).post("/auth/register/assistant").send({ token, ...input });
    expect(r.status).toBe(201);
    expect(r.body.data.accessToken).toEqual(expect.any(String));
    expect(r.body.data.user).not.toHaveProperty("passwordHash");
    expect(r.body.data.user.assistant.create.clinicId).toBeNull();
    expect(h.db.refreshToken.create).toHaveBeenCalledOnce();
  });
});
