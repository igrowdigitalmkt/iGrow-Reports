import type { LucideProps } from "lucide-react";

/**
 * Logo do WhatsApp em contorno, no mesmo estilo dos icones da barra (traco arredondado, currentColor).
 * Desenho: balao com cauda e o fone, como na marca. Geometria do icone "brand-whatsapp" do Tabler Icons (MIT).
 */
export function WhatsAppIcon({ size = 24, strokeWidth = 2, className, ...props }: LucideProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
    <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
    <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
  </svg>;
}
