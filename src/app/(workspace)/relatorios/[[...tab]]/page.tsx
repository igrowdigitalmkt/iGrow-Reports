import WorkspacePage, { type WorkspacePageProps } from "@/modules/operations/workspace-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReportsPage({ params, searchParams }: WorkspacePageProps & { params: Promise<{ tab?: string[] }> }) {
  const { tab = [] } = await params;
  return <WorkspacePage section={["relatorios", ...tab]} searchParams={searchParams} />;
}
