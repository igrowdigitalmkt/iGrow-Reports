import { createHmac } from "node:crypto";

/** Segredos de app configurados no ambiente (WhatsApp e Meta podem ser apps diferentes); o que servir para o app do token é usado. */
export const appSecretsFromEnv = (): string[] => [...new Set([process.env.WHATSAPP_APP_SECRET, process.env.META_APP_SECRET].map(value => value?.trim()).filter((value): value is string => !!value))];

export const proofParam = (token: string, secret: string) => `appsecret_proof=${createHmac("sha256", secret).update(token).digest("hex")}`;

/**
 * Envia o pedido à Graph API com a prova (`appsecret_proof`) de cada segredo candidato, em ordem, e por último sem prova. Só passa ao
 * próximo candidato quando a Meta recusa justamente a prova; qualquer outra resposta (sucesso ou erro) encerra a tentativa.
 */
export async function requestWithProof(secrets: string[], token: string, send: (proof: string) => Promise<Response>): Promise<Response> {
  const attempts: (string | null)[] = [...secrets, null];
  let last: Response | null = null;
  for (const secret of attempts) {
    const response = await send(secret ? proofParam(token, secret) : "");
    last = response;
    if (response.ok) return response;
    const text = await response.clone().text().catch(() => "");
    if (!/appsecret_proof/i.test(text)) return response;
  }
  return last as Response;
}
