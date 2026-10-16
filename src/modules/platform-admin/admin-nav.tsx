"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, Layers, Receipt, SlidersHorizontal, ToggleRight } from "lucide-react";

const ITEMS = [
  { href: "/admin", label: "Visão geral", icon: LayoutDashboard, exact: true },
  { href: "/admin/planos", label: "Planos", icon: Layers },
  { href: "/admin/comercial", label: "Configurações comerciais", icon: SlidersHorizontal },
  { href: "/admin/assinaturas", label: "Assinaturas", icon: Receipt },
  { href: "/admin/recursos", label: "Recursos e interruptores", icon: ToggleRight },
  { href: "/admin/organizacoes", label: "Organizações e concessões", icon: Building2 },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return <>{ITEMS.map(({ href, label, icon: Icon, ...rest }) => {
    const active = "exact" in rest ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active ? "bg-[var(--accent-bg)] font-medium text-[var(--blue)]" : "text-[var(--secondary)] hover:bg-[var(--surface-hover)]"}`}>
      <Icon size={16} aria-hidden="true" />{label}</Link>;
  })}</>;
}
