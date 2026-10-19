import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClientAnalyticsScreen, type ClientAnalyticsQuery } from "@/modules/client-portal/client-analytics-screen";
import { SECTION_SLUGS, VALID_SECTION_SLUGS } from "@/modules/client-portal/client-sections";

export const metadata: Metadata = {
  title: "Painel do cliente", robots: { index: false, follow: false }, referrer: "no-referrer",
};
export const maxDuration = 300;

/** /clientes/ID (Visao geral), /dashboard, /campanhas, /metricas, /relatorios. A troca entre secoes e feita no navegador. */
export default async function WorkspaceClientPage({ params, searchParams }: {
  params: Promise<{ clientId: string; section?: string[] }>;
  searchParams: Promise<ClientAnalyticsQuery>;
}) {
  const { clientId, section } = await params;
  const query = await searchParams;
  if (section && (section.length !== 1 || !VALID_SECTION_SLUGS.includes(section[0]!))) notFound();
  // Link antigo (?aba=reports): a aba virou a secao Relatorios.
  if (!section && query.aba === "reports") {
    const { aba: _legacy, ...rest } = query;
    void _legacy;
    const search = new URLSearchParams(Object.entries(rest).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
    redirect(`/clientes/${clientId}/${SECTION_SLUGS.reports}${search ? `?${search}` : ""}`);
  }
  return <ClientAnalyticsScreen clientId={clientId} query={query} frame="workspace" />;
}
