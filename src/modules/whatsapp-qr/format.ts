/** One WhatsApp session per workspace on the Evolution server. */
export function instanceNameFor(agencyId: string) {
  return `igrow-${agencyId}`;
}

/** Digits with country code; Brazilian numbers may be typed without +55, others start with +. */
export function normalizePairingPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (!value.trim().startsWith("+") && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function formatJidPhone(jid: string | null) {
  const digits = jid?.split("@")[0]?.split(":")[0]?.replace(/\D/g, "");
  if (!digits) return null;
  const br = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${digits}`;
}

export function formatPairingCode(code: string) {
  const clean = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
