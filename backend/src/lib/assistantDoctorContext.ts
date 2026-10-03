import { AsyncLocalStorage } from "node:async_hooks";

// Request-local selection; concurrent requests never share an acting doctor.
export const assistantDoctorContext = new AsyncLocalStorage<string | undefined>();
