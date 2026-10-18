import WorkspacePage, { type WorkspacePageProps } from "@/modules/operations/workspace-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function TeamPage({ searchParams }: WorkspacePageProps) {
  return <WorkspacePage section={["equipe"]} searchParams={searchParams} />;
}
