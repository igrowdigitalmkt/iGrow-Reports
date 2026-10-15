import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { SubscriptionScreen } from "@/modules/billing/subscription-screen";
import { loadSubscriptionPage } from "@/modules/billing/subscription-data";
import { deriveContractView, parseReturnHint } from "@/modules/billing/status-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assinatura", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Retorno do checkout do Asaas. O parâmetro "e" é só uma dica de texto: o estado exibido vem sempre do banco, e esta página
// NUNCA ativa, altera ou libera nada. A liberação depende da confirmação financeira validada pelo servidor.
export default async function SubscriptionReturnPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const [data, query] = await Promise.all([loadSubscriptionPage(), searchParams]);
  return <SubscriptionScreen data={data} view={deriveContractView(data.billing, parseReturnHint(query.e))} requestKey={randomUUID()} />;
}
