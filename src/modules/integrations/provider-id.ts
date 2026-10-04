export type ProviderId = "meta" | "google" | "tiktok" | "linkedin" | "youtube" | "whatsapp" | "qstash";

export function isProviderId(value: string): value is ProviderId {
  return value === "meta" || value === "google" || value === "tiktok" || value === "linkedin" || value === "youtube" || value === "whatsapp" || value === "qstash";
}

export function requireProviderId(value: string): ProviderId {
  if (!isProviderId(value)) throw new Error(`Provedor não suportado: ${value}`);
  return value;
}
