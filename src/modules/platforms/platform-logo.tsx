import type { PlatformKey } from "./registry";

/**
 * Marca da plataforma nos títulos de seção (sem quadrado de fundo). Desenhada em SVG a partir das cores oficiais de cada marca;
 * TikTok e LinkedIn só têm marca quando o conector existir.
 */
export function PlatformLogo({ platform, size = 28 }: { platform: PlatformKey; size?: number }) {
  if (platform === "meta") return <svg className="platform-logo" width={size} height={size * 0.6} viewBox="0 0 44 26" fill="none" aria-hidden="true">
    <defs><linearGradient id="meta-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0064e0" /><stop offset=".5" stopColor="#0081fb" /><stop offset="1" stopColor="#0064e0" /></linearGradient></defs>
    <path d="M22 13c-3.400-5.400-6.800-8-10.200-8C7.400 5 4.500 8.300 4.500 13s2.900 8 7.300 8c3.400 0 6.800-2.600 10.200-8s6.800-8 10.200-8c4.400 0 7.300 3.300 7.300 8s-2.900 8-7.300 8c-3.400 0-6.800-2.600-10.200-8z" stroke="url(#meta-grad)" strokeWidth="3.600" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (platform === "google") return <svg className="platform-logo" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <rect x="3" y="20" width="12" height="32" rx="6" transform="rotate(-30 9 36)" fill="#fbbc04" />
    <rect x="33" y="-6" width="12" height="38" rx="6" transform="rotate(30 39 13)" fill="#4285f4" />
    <circle cx="10" cy="39" r="6.500" fill="#34a853" /></svg>;
  return <span className={`platform-mark is-${platform}`} aria-hidden="true">{platform === "tiktok" ? "♪" : "in"}</span>;
}
