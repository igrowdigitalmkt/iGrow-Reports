"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type RowMenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; separatorBefore?: boolean };

// Compact action menu for table rows: opens below the trigger, closes on outside click or Escape.
export function RowMenu({ label, items, icon }: { label: string; items: RowMenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  function toggle() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const height = items.length * 34 + items.filter(item => item.separatorBefore).length * 9 + 10;
      const below = rect.bottom + 4 + height <= window.innerHeight;
      setPosition({ top: below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height), left: Math.max(8, rect.right - 220) });
    }
    setOpen(value => !value);
  }

  return <>
    <button ref={trigger} type="button" className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>{icon ?? <MoreHorizontal size={17} />}</button>
    {open && <div ref={menu} id={id} role="menu" className="menu-popover" style={{ position: "fixed", top: position.top, left: position.left, width: 220 }}>
      {items.map(item => <div key={item.label} role="none">
        {item.separatorBefore && <hr />}
        <button type="button" role="menuitem" className={item.danger ? "is-danger" : undefined} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon}{item.label}</button>
      </div>)}
    </div>}
  </>;
}
