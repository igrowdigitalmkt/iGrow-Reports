"use client";

import { useReportWebVitals } from "next/web-vitals";
import { isReportedVital, vitalsRoute } from "@/lib/web-vitals";

/** Envia as medidas reais de velocidade (LCP, INP, CLS, TTFB, FCP) para um registro simples no servidor. Não identifica a pessoa. */
export function WebVitals() {
  useReportWebVitals(metric => {
    if (!isReportedVital(metric.name)) return;
    const body = JSON.stringify({ name: metric.name, value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value), rating: metric.rating, nav: metric.navigationType, route: vitalsRoute(window.location.pathname) });
    try {
      if (!navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }))) void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
    } catch { /* medir nunca atrapalha a tela */ }
  });
  return null;
}
