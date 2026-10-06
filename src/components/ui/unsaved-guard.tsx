"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";
import { Dialog } from "./dialog";

/**
 * Asks "Deseja sair sem salvar suas alterações?" when there are unsaved changes and the person
 * clicks a link, closes the tab or (through `guard`) switches what is being edited.
 * `onSave` returns true when saving worked, so the pending step can continue.
 */
export function useUnsavedGuard(dirty: boolean, onSave: () => Promise<boolean>) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    // Links anywhere on the page (menu, tabs, breadcrumbs) go through the same question.
    const click = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(url.pathname + url.search + url.hash));
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty, router]);

  const guard = useCallback((next: () => void) => { if (dirtyRef.current) setPending(() => next); else next(); }, []);

  async function save() {
    setSaving(true);
    const ok = await onSave().catch(() => false);
    setSaving(false);
    if (!ok) { setPending(null); return; }
    const next = pending;
    setPending(null);
    next?.();
  }

  const dialog = <Dialog open={!!pending} onOpenChange={open => { if (!open && !saving) setPending(null); }} title="Deseja sair sem salvar suas alterações?" description="As alterações feitas desde o último salvamento serão perdidas se você descartar.">
    <div className="unsaved-actions">
      <Button variant="secondary" disabled={saving} onClick={() => { const next = pending; dirtyRef.current = false; setPending(null); next?.(); }}>Descartar</Button>
      <Button disabled={saving} onClick={save}>{saving ? "Salvando…" : "Salvar"}</Button>
    </div>
  </Dialog>;

  return { guard, dialog };
}
