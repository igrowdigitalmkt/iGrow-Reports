import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { backfillMetaHistory, listActiveMetaClients, runDailyMetaRefresh, warmStandardPeriods } from "@/modules/meta/daily-refresh";
import { pruneMetaHistory } from "@/modules/meta/retention";

export const runtime = "nodejs";
export const maxDuration = 300;

// Work stops starting new requests here, leaving margin for the request in flight.
const TOTAL_BUDGET_MS = 260_000;
const PHASE_CAP_MS = { refresh: 100_000, backfill: 50_000, warm: 100_000 };

// Vercel Cron (vercel.json) calls this once a day with Authorization: Bearer CRON_SECRET.
// Phases: revision window, one older history block, retention, standard periods.
// Each phase is isolated: its failure is logged and the next one still runs.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Agendamento indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  const executionId = randomUUID();
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Agendamento indisponível." }, { status: 503, headers });
  const started = performance.now();
  const remaining = (cap: number) => Math.max(0, Math.min(cap, TOTAL_BUDGET_MS - (performance.now() - started)));
  async function phase<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      const result = await run();
      console.info(`meta-daily-${name}`, { executionId, ...result });
      return result;
    } catch {
      console.error(`meta-daily-${name}-failed`, { executionId });
      return null;
    }
  }
  const targets = await phase("targets", async () => ({ list: await listActiveMetaClients(service) }));
  if (!targets) return Response.json({ executionId, error: "Não foi possível listar os clientes." }, { status: 500, headers });
  const refresh = await phase("refresh", () => runDailyMetaRefresh(service, { budgetMs: remaining(PHASE_CAP_MS.refresh), targets: targets.list }));
  const backfill = await phase("backfill", () => backfillMetaHistory(service, targets.list, { budgetMs: remaining(PHASE_CAP_MS.backfill) }));
  const retention = await phase("retention", () => pruneMetaHistory(service));
  const warm = await phase("warm", () => warmStandardPeriods(service, targets.list, { budgetMs: remaining(PHASE_CAP_MS.warm) }));
  return Response.json({ executionId, clients: targets.list.length, refresh, backfill, retention, warm }, { headers });
}
