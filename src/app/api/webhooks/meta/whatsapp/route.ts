import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseStatusEvents, validWebhookSignature } from "@/modules/whatsapp/webhook";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

// Meta verifies the endpoint once with a GET carrying our verify token.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// Delivery updates: signature checked, each status stored once, then applied without moving backwards.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET?.trim())) {
    return new Response("Invalid signature", { status: 401 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return new Response("Unavailable", { status: 503 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  for (const event of parseStatusEvents(payload)) {
    const { data: fresh, error } = await service.rpc("record_whatsapp_webhook", { p_dedup_key: event.dedupKey, p_payload: payload as Json });
    // Returning an error makes Meta retry later, so nothing is lost while the database is down.
    if (error) return new Response("Retry", { status: 503 });
    if (!fresh) continue;
    const applied = await service.rpc("apply_whatsapp_status", { p_wamid: event.wamid, p_status: event.status, p_at: event.at, p_error_code: event.errorCode, p_error_message: event.errorMessage });
    if (applied.error) return new Response("Retry", { status: 503 });
  }
  return new Response("OK", { status: 200 });
}
