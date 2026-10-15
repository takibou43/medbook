/** Mint a fresh test credential after changing Date, without relaxing production JWT expiry. */
export async function tokenAtTestClock(token: string): Promise<string> {
  const { signAccessToken } = await import("../../src/utils/jwt");
  const { sub, role } = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return signAccessToken({ sub, role });
}
