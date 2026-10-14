/**
 * Mensagem do banco quando o plano da organização barra uma operação (limite atingido: 53400, recurso fora
 * do plano ou desativado: 42501 "Recurso indisponível…"). Os textos são nossos e em português; qualquer outro
 * erro devolve null para o chamador manter a mensagem genérica de sempre.
 */
export function planRestrictionMessage(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error?.message) return null;
  if (error.code === "53400" && error.message.startsWith("Limite do plano atingido")) return error.message;
  if (error.code === "42501" && error.message.startsWith("Recurso indisponível no plano")) return error.message;
  return null;
}
