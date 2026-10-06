"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// A thin bar at the top of the page. It runs from an internal link click until the new
// route has rendered and every mounted route skeleton (useRouteSkeleton) has unmounted.
let clicked = false;
let skeletons = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const isBusy = () => clicked || skeletons > 0;

export function startNavigationProgress() { clicked = true; emit(); }
function settleClick() { if (clicked) { clicked = false; emit(); } }

export function useRouteSkeleton() {
  useEffect(() => {
    skeletons += 1; emit();
    return () => { skeletons -= 1; emit(); };
  }, []);
}

function isInternalNavigation(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const busy = useSyncExternalStore(subscribe, isBusy, () => false);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onClick = (event: MouseEvent) => { if (isInternalNavigation(event)) startNavigationProgress(); };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => { settleClick(); }, [pathname, search]);

  useEffect(() => {
    clearTimeout(timeout.current);
    if (busy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors an external store into an animation phase
      setPhase("running");
      // Never leave the bar stuck if a navigation is abandoned.
      timeout.current = setTimeout(settleClick, 20_000);
    } else {
      setPhase(previous => previous === "running" ? "done" : previous);
      timeout.current = setTimeout(() => setPhase("idle"), 500);
    }
    return () => clearTimeout(timeout.current);
  }, [busy]);

  return <div aria-hidden="true" className={`nav-progress${phase === "running" ? " is-running" : phase === "done" ? " is-done" : ""}`} />;
}
