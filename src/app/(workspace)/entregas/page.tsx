import WorkspacePage, { type WorkspacePageProps } from "@/modules/operations/workspace-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function LegacyDeliveriesPage({ searchParams }: WorkspacePageProps) {
  return <WorkspacePage section={["entregas"]} searchParams={searchParams} />;
}
