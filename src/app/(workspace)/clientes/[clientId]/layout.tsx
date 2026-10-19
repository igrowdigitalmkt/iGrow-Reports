import type { ReactNode } from "react";
import { requireAgencyContext } from "@/modules/agencies/context";
import { ClientMenu } from "@/modules/client-portal/client-menu";

/** Menu do cliente ao lado da barra principal recolhida. O nome vem do banco, ja filtrado pela organizacao do usuario. */
export default async function ClientLayout({ children, params }: { children: ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const context = await requireAgencyContext();
  const { data } = await context.supabase.from("clients").select("name").eq("id", clientId).eq("agency_id", context.agency.id).maybeSingle();
  return <>
    <ClientMenu clientName={data?.name ?? "Cliente"} />
    {children}
  </>;
}
