import type { ReactNode } from "react";
import { ClientMenu } from "@/modules/client-portal/client-menu";

export default function DemoClientLayout({ children }: { children: ReactNode }) {
  return <>
    <ClientMenu demo hideCampaigns clientName="Escola Horizonte" />
    {children}
  </>;
}
