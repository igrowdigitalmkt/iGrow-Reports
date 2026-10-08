import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Conservative maintenance: at most 4 batches of 250 rows.
 * QR messages older than 60 days in read, non-favorite chats are eligible.
 * Disabled until an encrypted baseline backup has been verified.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") {
    return Response.json({ error: "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  }
  if (process.env.WHATSAPP_RETENTION_ENABLED !== "true") {
    return Response.json({ enabled: false, removed: 0 }, { headers });
  }
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Banco indisponível." }, { status: 503, headers });
  let removed = 0;
  const started = performance.now();
  for (let batch = 0; batch < 4 && performance.now() - started < 15_000; batch++) {
    const { data, error } = await service.rpc("prune_whatsapp_qr_messages", { p_batch_size: 250 });
    if (error) {
      console.error("whatsapp-retention-failed", { code: error.code, batch });
      return Response.json({ error: "Limpeza adiada.", removed }, { status: 503, headers });
    }
    const count = Number(data);
    if (!Number.isInteger(count) || count < 0 || count > 250) {
      return Response.json({ error: "Retorno inesperado.", removed }, { status: 503, headers });
    }
    removed += count;
    if (count < 250) break;
  }
  console.info("whatsapp-retention", { removed, timeMs: Math.round(performance.now() - started) });
  return Response.json({ ok: true, removed }, { headers });
}
