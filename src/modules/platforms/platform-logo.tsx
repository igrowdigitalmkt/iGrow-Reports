import type { PlatformKey } from "./registry";

/**
 * Marca da plataforma nos títulos de seção (sem quadrado de fundo). Desenhada em SVG a partir das cores oficiais de cada marca;
 * TikTok e LinkedIn só têm marca quando o conector existir.
 */
export function PlatformLogo({ platform, size = 28 }: { platform: PlatformKey; size?: number }) {
  if (platform === "meta") return <svg className="platform-logo" width={size} height={size * 0.6} viewBox="0 0 44 26" fill="none" aria-hidden="true">
    <defs><linearGradient id="meta-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0064e0" /><stop offset=".5" stopColor="#0081fb" /><stop offset="1" stopColor="#0064e0" /></linearGradient></defs>
    <path d="M22 13c-3.400-5.400-6.800-8-10.200-8C7.400 5 4.500 8.300 4.500 13s2.900 8 7.300 8c3.400 0 6.800-2.600 10.200-8s6.800-8 10.200-8c4.400 0 7.300 3.300 7.300 8s-2.900 8-7.300 8c-3.400 0-6.800-2.600-10.200-8z" stroke="url(#meta-grad)" strokeWidth="3.600" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (platform === "google") return <svg className="platform-logo" width={size} height={size} viewBox="0 0 48 48" fill="none" strokeLinecap="round" aria-hidden="true">
    <path d="M19 10 8 35" stroke="#fbbc04" strokeWidth="11" />
    <path d="M28 9 39 35" stroke="#4285f4" strokeWidth="11" />
    <circle cx="39" cy="40" r="5.500" fill="#34a853" /></svg>;
  return <span className={`platform-mark is-${platform}`} aria-hidden="true">{platform === "tiktok" ? "♪" : "in"}</span>;
}
