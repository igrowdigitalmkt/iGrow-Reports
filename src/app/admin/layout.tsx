import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: { default: "Super Admin", template: "%s · Super Admin" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

// Sem verificação aqui: layouts não rodam de novo a cada navegação. Cada página chama a guarda.
export default function AdminRootLayout({ children }: { children: ReactNode }) { return children; }
