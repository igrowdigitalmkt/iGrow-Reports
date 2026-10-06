import Link from "next/link";
import { REPORT_TABS, SECTION_PATHS } from "./routes";

// Tabs inside Relatórios, same look as the client dashboard tabs.
export function ReportTabs({ base, section }: { base: string; section: string }) {
  return <nav className="page-tabs" aria-label="Seções de relatórios">
    {REPORT_TABS.map(tab => <Link key={tab.section} href={`${base}/${SECTION_PATHS[tab.section]}`} aria-current={tab.section === section ? "page" : undefined}>{tab.label}</Link>)}
  </nav>;
}
