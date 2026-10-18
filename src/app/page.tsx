import type { Metadata } from "next";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePageProps } from "@/modules/operations/workspace-page";
import { SalesPage } from "@/modules/marketing/sales-page";
import { EXECUTION_LIVE } from "@/modules/marketing/sales-flags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const hasSession = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && Boolean(user);
});

export async function generateMetadata(): Promise<Metadata> {
  if (await hasSession()) return { title: "Visão geral", robots: { index: false, follow: false } };
  return {
    title: { absolute: "Groow Ads — Inteligência de marketing para os seus anúncios" },
    description: EXECUTION_LIVE ? "Você define onde chegar; a Groow Ads trabalha nisso: analisa, cria, ajusta e corrige campanhas dentro dos seus limites. Teste 7 dias sem cartão." : "Você define onde chegar; a Groow Ads trabalha nisso. Hoje: análises com IA, relatórios e entregas agendadas. Execução de campanhas por IA em desenvolvimento. Teste 7 dias sem cartão.",
    alternates: { canonical: "https://groowads.com" },
    icons: { icon: "/brand/groow-icon-blue.png", apple: "/brand/groow-icon-blue.png" },
    robots: { index: true, follow: true },
    openGraph: { title: "Você define onde chegar. A Groow Ads faz o trabalho.", description: EXECUTION_LIVE ? "Uma IA que conhece o seu negócio e executa o trabalho nas suas campanhas, dentro dos limites que você define." : "Análises com IA, relatórios e entregas agendadas hoje. Execução de campanhas por IA em desenvolvimento.", url: "https://groowads.com", siteName: "Groow Ads", locale: "pt_BR", type: "website" },
  };
}

export default async function HomePage({ searchParams }: WorkspacePageProps) {
  if (!(await hasSession())) return <SalesPage />;
  const [{ default: WorkspaceLayout }, { default: WorkspacePage }] = await Promise.all([
    import("./(workspace)/layout"), import("@/modules/operations/workspace-page"),
  ]);
  // Both existing server guards still run; the public page never receives
  // organization data, permissions, or the authenticated workspace payload.
  return <WorkspaceLayout><WorkspacePage searchParams={searchParams} /></WorkspaceLayout>;
}
