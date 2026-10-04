import Decimal from "decimal.js";
import type { MetaInsight } from "./client";
import { isZeroDeliveryInsight } from "./result-values";

const ResultDecimal = Decimal.clone({ precision: 60 });
export type NativeWorkerResults = { known: boolean; values: Record<string,string> };

// Alternative attribution windows and different indicators are never added.
export function nativeWorkerResults(row: MetaInsight): NativeWorkerResults {
  const unknown = { known: false,values: {} };
  if (isZeroDeliveryInsight(row)) return { known: true,values: {} };
  if (!Array.isArray(row.results)) return unknown;
  const values = new Map<string,string>();
  for (const result of row.results) {
    if (!result || typeof result !== "object") return unknown;
    const entry = result as Record<string,unknown>;
    const indicator = typeof entry.indicator === "string" ? entry.indicator.replace(/^actions:/,"action:") : "";
    if (!/^[a-zA-Z0-9_.:]{1,160}$/.test(indicator) || values.has(indicator) || !Array.isArray(entry.values) || entry.values.length!==1) return unknown;
    const item = entry.values[0];
    if (!item || typeof item !== "object") return unknown;
    const raw = (item as Record<string,unknown>).value;
    if ((typeof raw!=="string" && typeof raw!=="number") || (typeof raw==="string" && !raw.trim())
      || (typeof raw==="number" && (!Number.isFinite(raw) || Math.abs(raw)>Number.MAX_SAFE_INTEGER))) return unknown;
    try {
      const value = new ResultDecimal(raw);
      if (!value.isFinite() || value.isNegative()) return unknown;
      values.set(indicator,value.toFixed());
    } catch { return unknown; }
  }
  return { known: true,values: Object.fromEntries(values) };
}

export function workerResultIndicators(row: MetaInsight,spend: string | null) {
  const native = nativeWorkerResults(row);
  const counts = Object.values(native.values);
  const primary = !native.known || counts.length>1 ? null : counts[0] ?? "0";
  const cost = primary!==null && spend!==null && !new ResultDecimal(primary).isZero()
    ? new ResultDecimal(spend).div(primary).toFixed() : null;
  return { ...native,primary,cost };
}
