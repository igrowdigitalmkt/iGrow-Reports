const DAY = 86_400_000;
// Warn this many days before the authorization ends, so there is time to reconnect.
export const TOKEN_WARNING_DAYS = 10;

export type TokenExpiry = { level: "ok" | "soon" | "expired"; daysLeft: number; expiresAt: string } | null;

/** Expiry of a token from Meta's debug_token answer. 0 or missing means it does not expire. */
export function expiryFromDebugToken(body: unknown): string | null {
  const data = (body as { data?: { expires_at?: unknown } } | null)?.data;
  const seconds = typeof data?.expires_at === "number" ? data.expires_at : 0;
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export function tokenExpiry(expiresAt: string | null | undefined, now: Date): TokenExpiry {
  if (!expiresAt) return null;
  const time = Date.parse(expiresAt);
  if (!Number.isFinite(time)) return null;
  const daysLeft = Math.ceil((time - now.getTime()) / DAY);
  return { level: time <= now.getTime() ? "expired" : daysLeft <= TOKEN_WARNING_DAYS ? "soon" : "ok", daysLeft: Math.max(daysLeft, 0), expiresAt };
}
