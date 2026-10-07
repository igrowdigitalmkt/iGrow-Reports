import type { ReactNode } from "react";

export type DonutSlice = { key: string; value: number; color: string; title: string };

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// SVG ring shared by the dashboard donuts: one stroke segment per slice with a small gap between them.
export function DonutRing({ slices, label, children }: { slices: DonutSlice[]; label: string; children?: ReactNode }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  // Start of each slice along the ring, in the same order as the slices.
  const starts = slices.map((_, index) => slices.slice(0, index).reduce((sum, slice) => sum + slice.value / total * CIRCUMFERENCE, 0));
  return <svg viewBox="0 0 132 132" role="img" aria-label={label}>
    <circle cx="66" cy="66" r={RADIUS} className="audience-track" />
    {total > 0 && slices.map((slice, index) => {
      const length = slice.value / total * CIRCUMFERENCE;
      return <circle key={slice.key} cx="66" cy="66" r={RADIUS} stroke={slice.color} strokeDasharray={`${Math.max(length - 1.5, 0.5)} ${CIRCUMFERENCE}`} strokeDashoffset={-starts[index]} className="audience-segment"><title>{slice.title}</title></circle>;
    })}
    {children}
  </svg>;
}
