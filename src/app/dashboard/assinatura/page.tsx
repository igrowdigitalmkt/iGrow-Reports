import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { SubscriptionScreen } from "@/modules/billing/subscription-screen";
import { loadSubscriptionPage } from "@/modules/billing/subscription-data";
import { deriveContractView } from "@/modules/billing/status-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assinatura", robots: { index: false, follow: false } };

export default async function SubscriptionPage() {
  const data = await loadSubscriptionPage();
  // Chave de reenvio desta visita: dois cliques no mesmo botão compartilham a mesma chave (e o banco devolve a mesma intenção).
  return <SubscriptionScreen data={data} view={deriveContractView(data.billing)} requestKey={randomUUID()} />;
}
