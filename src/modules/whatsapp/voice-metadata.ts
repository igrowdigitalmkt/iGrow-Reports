/** Trusted presentation-only duration from the WhatsApp/Baileys encrypted media reference.
 * The reference must never be passed to the browser; only its duration is exposed.
 * Cloud API media references often omit it, so client audio decoding remains a fallback. */
export function voiceDurationFromRef(reference: unknown): number | null {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const ref = reference as { type?: unknown; data?: unknown };
  if (ref.type !== "audioMessage" || !ref.data || typeof ref.data !== "object" || Array.isArray(ref.data)) return null;
  const raw = (ref.data as Record<string, unknown>).seconds;
  const value = raw && typeof raw === "object" && "low" in raw ? (raw as { low: unknown }).low : raw;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? seconds : null;
}
