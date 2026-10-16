"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

// Intervalos crescentes: confirmação normal em segundos; se demorar, a consulta fica mais espaçada (a recuperação roda no servidor).
const delayFor = (attempt: number) => (attempt < 12 ? 5000 : attempt < 40 ? 15000 : 60000);
const MAX_ATTEMPTS = 70; // ~ 1 min a cada 5 s + 7 min a cada 15 s + ~30 min a cada 60 s

/**
 * Acompanha só o estado da contratação (uma consulta pequena, sem recarregar o painel). Quando o estado muda, recarrega a página UMA vez
 * para mostrar o resultado. Não decide nada: o estado vem do banco. Pausa com a aba oculta.
 */
export function ReturnWatcher({ initialState, hint }: { initialState: string; hint: string | null }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const refreshed = useRef(false);
  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS || refreshed.current) return;
    const timer = setTimeout(async () => {
      if (document.visibilityState === "hidden") { setAttempts((value) => value + 1); return; }
      try {
        const response = await fetch(`/api/billing/state${hint ? `?e=${encodeURIComponent(hint)}` : ""}`, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { state?: string; polling?: boolean };
          if (data.state && data.state !== initialState) { refreshed.current = true; router.refresh(); return; }
        }
      } catch {
        // Falha de rede: tenta de novo no próximo intervalo.
      }
      setAttempts((value) => value + 1);
    }, delayFor(attempts));
    return () => clearTimeout(timer);
  }, [attempts, hint, initialState, router]);
  return attempts >= MAX_ATTEMPTS
    ? <p className="billing-muted" role="status">A confirmação está demorando mais que o normal. Não pague de novo: a conferência continua em segundo plano. Recarregue a página mais tarde ou fale com o suporte.</p>
    : <p className="billing-muted" role="status"><LoaderCircle size={14} className="billing-spin" aria-hidden="true" /> Atualizando automaticamente…</p>;
}
