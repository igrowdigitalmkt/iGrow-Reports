import type { Metadata } from "next";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePageProps } from "@/modules/operations/workspace-page";
import { SalesPage } from "@/modules/marketing/sales-page";

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
    title: { absolute: "Groow Ads — Inteligência a serviço do seu negócio" },
    description: "Conheça a inteligência da Groow Ads: contexto do negócio, análises com IA e entregas agendadas. Veja a interface real e experimente por 7 dias.",
    alternates: { canonical: "https://groowads.com" },
    icons: { icon: "/brand/groow-icon-blue.png", apple: "/brand/groow-icon-blue.png" },
    robots: { index: true, follow: true },
    openGraph: { title: "Seu marketing precisa avançar. Você não precisa fazer tudo. | Groow Ads", description: "Conheça a Groow Ads por dentro: análises com IA, relatórios e entregas agendadas. Execução de campanhas por IA em desenvolvimento.", url: "https://groowads.com", siteName: "Groow Ads", locale: "pt_BR", type: "website" },
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
