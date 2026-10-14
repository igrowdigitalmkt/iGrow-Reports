import type { ReactNode } from "react";
import { AdminShell } from "@/modules/platform-admin/admin-shell";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";

// Toda página deste grupo também chama requirePlatformOperator() (o resultado é compartilhado na requisição).
export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
  const { operator } = await requirePlatformOperator();
  return <AdminShell operator={operator}>{children}</AdminShell>;
}
