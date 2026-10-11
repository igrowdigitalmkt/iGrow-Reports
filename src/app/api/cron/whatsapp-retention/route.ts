import { authorizeWorkerRequest } from "@/modules/integrations/worker-auth";

export const runtime = "nodejs";

/** History preservation is mandatory, including privileged scheduled jobs. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const auth = authorizeWorkerRequest(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth !== "authorized") {
    return Response.json({ error: "Acesso negado." }, { status: auth === "unconfigured" ? 503 : 401, headers });
  }
  return Response.json({ enabled: false, removed: 0, reason: "history_preservation" }, { headers });
}
