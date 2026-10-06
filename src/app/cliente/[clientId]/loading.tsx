import { ClientAnalyticsSkeleton } from "@/components/layout/client-analytics-skeleton";
import "@/modules/client-portal/portal-shell.css";

export default function ClientOverviewLoading() {
  return <main className="client-portal">
    <div className="client-topbar" />
    <div className="client-container"><ClientAnalyticsSkeleton /></div>
  </main>;
}
