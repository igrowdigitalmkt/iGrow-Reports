import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/layout/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "iGrow Reports · Sua operação em perspectiva", template: "%s · iGrow Reports" },
  description: "Plataforma de relatórios de tráfego da iGrow Digital.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-scroll-behavior="smooth" suppressHydrationWarning><body className={`${GeistSans.variable} ${GeistMono.variable}`}><Providers>{children}</Providers></body></html>;
}

