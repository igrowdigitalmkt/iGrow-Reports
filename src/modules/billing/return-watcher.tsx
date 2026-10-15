"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

const INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 120; // 10 minutos

/** Atualiza a tela a cada poucos segundos enquanto o servidor confirma o pagamento. Não decide nada: só relê o estado do banco. */
export function ReturnWatcher() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (attempts >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => { router.refresh(); setAttempts((value) => value + 1); }, INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempts, router]);
  return attempts >= MAX_ATTEMPTS
    ? <p className="billing-muted" role="status">A confirmação está demorando mais que o normal. Você não será cobrado de novo; recarregue a página em alguns minutos.</p>
    : <p className="billing-muted" role="status"><LoaderCircle size={14} className="billing-spin" aria-hidden="true" /> Atualizando automaticamente…</p>;
}
