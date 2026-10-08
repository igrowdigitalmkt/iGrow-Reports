/** Only terminal credential revocation is destructive.
 * Temporary close states (428/440) and network retries must not erase messages.
 */
export function isConfirmedQrLogout(body: unknown): boolean {
  const p = body as { event?: unknown; data?: { state?: unknown; statusReason?: unknown } } | null;
  if (!p || (p.event !== "connection.update" && p.event !== "CONNECTION_UPDATE")) return false;
  return p.data?.state === "close" && (Number(p.data?.statusReason) === 401 || Number(p.data?.statusReason) === 403);
}
