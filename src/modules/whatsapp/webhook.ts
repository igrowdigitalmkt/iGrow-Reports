import { createHmac, timingSafeEqual } from "node:crypto";

// Meta signs each webhook body with the app secret (X-Hub-Signature-256: sha256=<hex>).
export function validWebhookSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!header || !appSecret) return false;
  const [scheme, signature] = header.split("=");
  if (scheme !== "sha256" || !/^[0-9a-f]{64}$/i.test(signature ?? "")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type WhatsAppStatusEvent = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  dedupKey: string;
};

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

// Extracts message status updates from a webhook payload; anything else is ignored.
export function parseStatusEvents(payload: unknown): WhatsAppStatusEvent[] {
  const events: WhatsAppStatusEvent[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const raw of statuses) {
        const item = raw as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: Array<{ code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } }> };
        if (typeof item.id !== "string" || typeof item.status !== "string" || !STATUSES.has(item.status)) continue;
        const seconds = Number(item.timestamp);
        const error = Array.isArray(item.errors) ? item.errors[0] : undefined;
        const message = [error?.title, error?.message, error?.error_data?.details].find(value => typeof value === "string") as string | undefined;
        events.push({
          wamid: item.id, status: item.status as WhatsAppStatusEvent["status"],
          at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
          errorCode: error?.code != null ? String(error.code).slice(0, 40) : null,
          errorMessage: message ? message.slice(0, 1000) : null,
          dedupKey: `${item.id}:${item.status}:${Number.isFinite(seconds) ? seconds : "?"}`.slice(0, 300),
        });
      }
    }
  }
  return events;
}
