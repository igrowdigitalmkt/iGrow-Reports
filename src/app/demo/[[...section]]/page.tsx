import { notFound, redirect } from "next/navigation";
import { isDemoEnabled } from "@/lib/env";
import { DashboardWorkspace } from "@/modules/operations/dashboard-workspace";
import { legacyRedirect, SECTION_ROUTES } from "@/modules/operations/routes";

export const dynamic = "force-dynamic";

export default async function DemoPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section = [] } = await params;
  const path = section.join("/");
  if (!isDemoEnabled()) notFound();
  const legacy = legacyRedirect("/demo", path, {});
  if (legacy) redirect(legacy);
  const key = SECTION_ROUTES[path];
  if (key === undefined) notFound();
  return <DashboardWorkspace demo section={key} identity={{ agencyName: "iGrow Digital", userName: "Silvio", roleLabel: "Proprietário · demonstração", timezone: "America/Sao_Paulo" }} />;
}
