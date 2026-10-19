import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { Providers } from "@/components/layout/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Groow Ads", template: "%s · Groow Ads" },
  description: "Groow Ads: plataforma de relatórios e análise de anúncios, da iGrow Digital.",
  robots: { index: false, follow: false },
};

// Decisão do proprietário (19/10/2026): site e plataforma se comportam como aplicativo, sem zoom
// automático ao tocar em campos nem zoom por gesto.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" data-scroll-behavior="smooth" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning><body><Providers>{children}</Providers></body></html>;
}
