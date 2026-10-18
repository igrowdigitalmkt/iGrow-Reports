import type { Metadata } from "next";
import { ClientAnalyticsScreen, type ClientAnalyticsQuery } from "@/modules/client-portal/client-analytics-screen";

export const metadata: Metadata = {
  title: "Painel do cliente", robots: { index: false, follow: false }, referrer: "no-referrer",
};
export const maxDuration = 300;

export default async function WorkspaceClientPage({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<ClientAnalyticsQuery>;
}) {
  const { clientId } = await params;
  return <ClientAnalyticsScreen clientId={clientId} query={await searchParams} frame="workspace" />;
}
