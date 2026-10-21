"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./sales-page.module.css";

/** Entrada suave ao rolar. Sem JavaScript, com movimento reduzido ou já visível na abertura, o conteúdo aparece direto. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "armed" | "in">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    const arm = requestAnimationFrame(() => setState("armed"));
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setState("in"); observer.disconnect(); } }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
    observer.observe(el);
    return () => { cancelAnimationFrame(arm); observer.disconnect(); };
  }, []);
  return <div ref={ref} className={`${className} ${state === "armed" ? styles.revealArmed : ""} ${state === "in" ? styles.revealIn : ""}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>{children}</div>;
}
