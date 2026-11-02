import { requestWithProof } from "./graph-proof";

export type GraphResult = { ok: boolean; status: number; body: Record<string, unknown> | null; code: string; message: string };

/**
 * Chamada à Graph API com token no cabeçalho e a prova de segurança (appsecret_proof) por segredo candidato. Nunca devolve nem registra o
 * token; do erro só saem o código, o subcódigo e a mensagem curta da Meta.
 */
export async function graphCall(input: { path: string; token: string; apiVersion: string; appSecrets?: string[]; method?: "GET" | "POST"; body?: Record<string, string>; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<GraphResult> {
  const response = await requestWithProof(input.appSecrets ?? [], input.token, proof => (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.apiVersion}/${input.path}${proof ? `${input.path.includes("?") ? "&" : "?"}${proof}` : ""}`, {
      method: input.method ?? "GET", headers: { Authorization: `Bearer ${input.token}`, ...(input.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: input.body ? new URLSearchParams(input.body).toString() : undefined, cache: "no-store", signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
    }));
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const error = body?.error as { code?: unknown; error_subcode?: unknown; message?: unknown } | undefined;
  return { ok: response.ok && !error, status: response.status, body, code: error ? `${String(error.code ?? "-")}/${String(error.error_subcode ?? "-")}` : "-", message: typeof error?.message === "string" ? error.message.slice(0, 300) : "" };
}
