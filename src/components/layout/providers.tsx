"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { DropdownDismiss } from "@/components/ui/dropdown-dismiss";

export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem><MotionConfig reducedMotion="user">{children}<DropdownDismiss /></MotionConfig></ThemeProvider>;
}

