/** Medição real de velocidade (Core Web Vitals): regras puras compartilhadas pelo navegador e pelo servidor. */

export const REPORTED_VITALS = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;
export type ReportedVital = (typeof REPORTED_VITALS)[number];

/** Troca ids e códigos do endereço por `:id`: o registro mostra a tela, nunca quem a abriu nem um link privado. */
export function vitalsRoute(pathname: string): string {
  const parts = pathname.split("?")[0]!.split("/").map(part =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) || /^[A-Za-z0-9_-]{16,}$/.test(part) || /^\d{5,}$/.test(part) ? ":id" : part);
  return parts.join("/").slice(0, 120) || "/";
}

export function isReportedVital(name: unknown): name is ReportedVital {
  return typeof name === "string" && (REPORTED_VITALS as readonly string[]).includes(name);
}
