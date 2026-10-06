// Messages the Meta Embedded Signup window posts back with the chosen account and number.
export type EmbeddedSignupResult =
  | { kind: "finish"; wabaId: string; phoneNumberId: string; coexistence: boolean }
  | { kind: "cancel"; step: string | null }
  | { kind: "error"; message: string };

export const EMBEDDED_SIGNUP_COEXISTENCE = "whatsapp_business_app_onboarding";

export function parseEmbeddedSignupMessage(origin: string, data: unknown): EmbeddedSignupResult | null {
  let host: string;
  try { host = new URL(origin).hostname; } catch { return null; }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let payload: unknown = data;
  if (typeof data === "string") { try { payload = JSON.parse(data); } catch { return null; } }
  const message = payload as { type?: unknown; event?: unknown; data?: { waba_id?: unknown; phone_number_id?: unknown; current_step?: unknown; error_message?: unknown } };
  if (message?.type !== "WA_EMBEDDED_SIGNUP" || typeof message.event !== "string") return null;
  if (message.event === "CANCEL") {
    const step = message.data?.current_step;
    if (typeof message.data?.error_message === "string") return { kind: "error", message: message.data.error_message };
    return { kind: "cancel", step: typeof step === "string" ? step : null };
  }
  if (!message.event.startsWith("FINISH")) return null;
  const wabaId = String(message.data?.waba_id ?? ""), phoneNumberId = String(message.data?.phone_number_id ?? "");
  if (!/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneNumberId)) return { kind: "error", message: "A Meta não informou o número escolhido." };
  return { kind: "finish", wabaId, phoneNumberId, coexistence: message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" };
}
