import { redirect } from "next/navigation";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requirePlatformOperator();
  redirect("/admin/integracoes/pagamentos");
}
