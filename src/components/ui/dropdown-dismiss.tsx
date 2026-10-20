"use client";

import { useEffect } from "react";

/** Menus suspensos feitos com <details>: todos fecham ao clicar fora ou ao pressionar Esc. (Seções de leitura, como FAQ, não entram.) */
export const DROPDOWN_DETAILS = [
  "details.analytics-quality-menu", "details.analytics-filter-menu", "details.campaigns-accounts", "details.campaigns-columns", "details.summary-alerts",
].join(",");

export function closeDropdownsOutside(target: EventTarget | null, root: ParentNode = document) {
  for (const menu of root.querySelectorAll<HTMLDetailsElement>(`${DROPDOWN_DETAILS}[open]`)) {
    const inside = !!target && typeof (target as Node).nodeType === "number" && menu.contains(target as Node);
    if (!inside) menu.removeAttribute("open");
  }
}

/** Montado uma vez na raiz: um único ouvinte cuida de todos os menus suspensos da plataforma. */
export function DropdownDismiss() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => closeDropdownsOutside(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = document.querySelector<HTMLDetailsElement>(`${DROPDOWN_DETAILS}[open]`);
      if (!open) return;
      closeDropdownsOutside(null);
      open.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, []);
  return null;
}
