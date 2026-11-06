"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { DropdownDismiss } from "@/components/ui/dropdown-dismiss";

export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem>{children}<DropdownDismiss /></ThemeProvider>;
}

