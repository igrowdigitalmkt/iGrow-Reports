import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { isSidebarCollapsed, SIDEBAR_COOKIE } from "@/components/layout/sidebar-state";
import { isDemoEnabled } from "@/lib/env";

export default async function DemoLayout({ children }: { children: ReactNode }) {
  if (!isDemoEnabled()) notFound();
  const collapsed = isSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return <AppShell demo initialCollapsed={collapsed} clientCount={6}
    identity={{ agencyName: "iGrow Digital", userName: "Silvio", roleLabel: "Proprietário · demonstração", timezone: "America/Sao_Paulo" }}>
    {children}
  </AppShell>;
}
