import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveBillingEnvironment } from "@/modules/billing/credentials";
import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";
import { readCronHealth } from "@/modules/billing/cron-monitor";
import { asBillingDb } from "@/modules/billing/db";

export const runtime = "nodejs";
export const maxDuration = 30;

// Saúde do agendamento financeiro, para um monitor externo (HTTP 200 = saudável; 503 = alerta). Mesma autenticação do cron
// (Bearer CRON_SECRET). Não executa nenhum trabalho financeiro nem expõe segredo, token ou dado de cliente: só horários, estados e contagens.
// Alertas previstos: mais de 15 min sem execução bem-sucedida, 3 execuções seguidas sem sucesso e acúmulo de pendências.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") return Response.json({ error: auth === "unconfigured" ? "Monitoramento indisponível." : "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Monitoramento indisponível." }, { status: 503, headers });
  const health = await readCronHealth(asBillingDb(service), await resolveBillingEnvironment());
  if (!health) return Response.json({ ok: false, flags: ["monitor_unavailable"] }, { status: 503, headers });
  return Response.json(health, { status: health.ok ? 200 : 503, headers });
}
