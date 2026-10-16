import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveBillingCredentials } from "@/modules/billing/credentials";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { asBillingDb, callRpc } from "@/modules/billing/db";
import { finishCronRun, startCronRun, summarizeCronResult } from "@/modules/billing/cron-monitor";
import { drainBillingEvents } from "@/modules/billing/event-processor";
import { reconcileBilling } from "@/modules/billing/reconcile";
import { createBillingRuntime } from "@/modules/billing/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Rotina periódica da fundação financeira (NÃO agendada em vercel.json; só roda se chamada com CRON_SECRET, p.ex. por um agendador externo):
// 1) prazos que vencem sem evento (tolerância, fim de período pago, teste, intenções); 2) eventos gravados e não processados;
// 3) reconciliação com o Asaas. Os passos que falam com o Asaas só rodam com o Sandbox configurado.
// Cada execução é registrada (identificador, horários, estado, duração e contagens) para o monitoramento em /api/cron/billing/health.
// Chamadas simultâneas são seguras: eventos e assinaturas são reivindicados com trava no banco e a manutenção é idempotente.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Rotina indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Rotina indisponível." }, { status: 503, headers });
  const db = asBillingDb(service);
  const credentials = await resolveBillingCredentials({ db });
  const deps = await createBillingRuntime(credentials);
  const runId = await startCronRun(db, deps?.environment ?? credentials?.environment ?? "sandbox");
  try {
    const maintenance = await callRpc<Record<string, unknown>>(db, "billing_run_maintenance");
    if (!deps) {
      await finishCronRun(db, runId, summarizeCronResult({ maintenance }));
      return Response.json({ maintenance, gateway: "not_configured" }, { headers });
    }
    // Orçamento de tempo (a função tem 120 s): chamadas lentas ao Asaas não podem estourar o limite; o que sobrar é retomado na próxima rodada.
    const deadlineMs = Date.now() + 90_000;
    const events = await drainBillingEvents(deps, { limit: 10, deadlineMs });
    const reconciliation = await reconcileBilling(deps, { limit: 15, deadlineMs });
    console.info("billing-cron", { events, reconciliation });
    await finishCronRun(db, runId, summarizeCronResult({ maintenance, events: events as unknown as Record<string, unknown>, reconciliation: reconciliation as unknown as Record<string, unknown> }));
    return Response.json({ maintenance, events, reconciliation }, { headers });
  } catch {
    console.error("billing-cron-failed");
    await finishCronRun(db, runId, { status: "failed", items: 0, failures: 1, counts: {}, errorCode: "cron_exception" });
    return Response.json({ error: "Não foi possível executar a rotina financeira." }, { status: 500, headers });
  }
}
