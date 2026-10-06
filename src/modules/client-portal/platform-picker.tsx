"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, GripVertical, Layers } from "lucide-react";

export type PlatformKey = "meta" | "google" | "tiktok";
export type PlatformPreference = { key: PlatformKey; enabled: boolean };

export const PLATFORMS: Record<PlatformKey, { label: string; available: boolean; mark: string }> = {
  meta: { label: "Meta Ads", available: true, mark: "∞" },
  google: { label: "Google Ads", available: false, mark: "G" },
  tiktok: { label: "TikTok Ads", available: false, mark: "♪" },
};
export const DEFAULT_PLATFORMS: PlatformPreference[] = [{ key: "meta", enabled: true }, { key: "google", enabled: false }, { key: "tiktok", enabled: false }];

// Choose which platforms appear (one, several or all) and drag to set their order on the page.
export function PlatformPicker({ value, onChange }: { value: PlatformPreference[]; onChange: (next: PlatformPreference[]) => void }) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<PlatformKey | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const active = value.filter(item => item.enabled && PLATFORMS[item.key].available);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);

  function move(source: PlatformKey, target: PlatformKey) {
    if (source === target) return;
    const next = value.filter(item => item.key !== source);
    const from = value.findIndex(item => item.key === source), to = value.findIndex(item => item.key === target);
    next.splice(next.findIndex(item => item.key === target) + (from < to ? 1 : 0), 0, value[from]);
    onChange(next);
  }

  return <div className="platform-picker" ref={root}>
    <button type="button" className="analytics-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <Layers size={15} />{active.length === 0 ? "Nenhuma plataforma" : active.length === 1 ? PLATFORMS[active[0].key].label : `${active.length} plataformas`}<ChevronDown size={14} />
    </button>
    {open && <div className="platform-popover" role="dialog" aria-label="Plataformas exibidas">
      <strong>Plataformas</strong>
      <p>Escolha quais aparecem e arraste para mudar a ordem.</p>
      <ul>{value.map(item => {
        const platform = PLATFORMS[item.key];
        return <li key={item.key} draggable={platform.available} className={dragging === item.key ? "is-dragging" : undefined}
          onDragStart={() => setDragging(item.key)} onDragOver={event => { if (dragging) event.preventDefault(); }}
          onDrop={() => { if (dragging) move(dragging, item.key); setDragging(null); }} onDragEnd={() => setDragging(null)}>
          <GripVertical size={14} className="platform-grip" aria-hidden="true" />
          <span className={`platform-mark is-${item.key}`} aria-hidden="true">{platform.mark}</span>
          <label>
            <input type="checkbox" checked={item.enabled && platform.available} disabled={!platform.available}
              onChange={() => onChange(value.map(entry => entry.key === item.key ? { ...entry, enabled: !entry.enabled } : entry))} />
            <span>{platform.label}</span>
          </label>
          {platform.available ? item.enabled && <Check size={14} className="platform-check" /> : <span className="badge neutral">Em breve</span>}
        </li>;
      })}</ul>
    </div>}
  </div>;
}
