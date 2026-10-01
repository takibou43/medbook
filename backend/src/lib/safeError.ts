/** Fixed diagnostic codes only; database/parser/provider errors may embed secrets. */
export function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  if (typeof code === "string" && ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND"].includes(code)) return code;
  return error instanceof SyntaxError ? "INVALID_JSON" : "UNEXPECTED_ERROR";
}
