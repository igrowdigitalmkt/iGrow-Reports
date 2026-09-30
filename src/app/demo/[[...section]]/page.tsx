import { notFound } from "next/navigation";
import { isDemoEnabled } from "@/lib/env";
import { DashboardWorkspace } from "@/modules/operations/dashboard-workspace";

const sections = ["", "clientes", "relatorios", "templates", "agendamentos", "entregas", "integracoes", "configuracoes"];

export const dynamic = "force-dynamic";

export default async function DemoPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  const key = section.join("/");
  if (!isDemoEnabled() || !sections.includes(key)) notFound();
  return <DashboardWorkspace demo section={key} identity={{ agencyName: "iGrow Digital", userName: "Silvio", roleLabel: "Proprietário · demonstração", timezone: "America/Sao_Paulo" }} />;
}
