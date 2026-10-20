"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_SELECTION, parseStoredSelection, serializeSelection, type NavSelection } from "./selection";

/**
 * Seleção persistida por contexto (organização + usuário + cliente + plataforma) em sessionStorage, com cópia em memória caso o
 * armazenamento esteja indisponível. Sobrevive a atualização, voltar/avançar e ida e volta aos detalhes; nunca atravessa clientes porque a
 * chave inclui o cliente. No servidor e na hidratação a seleção é vazia.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = (key: string): string | null => {
  const cached = memory.get(key);
  if (cached !== undefined) return cached;
  try { return window.sessionStorage.getItem(key); } catch { return null; }
};

export function useStoredSelection(key: string | null): [NavSelection, (next: NavSelection) => void] {
  const raw = useSyncExternalStore(subscribe, () => key ? read(key) : null, () => null);
  const selection = useMemo(() => parseStoredSelection(raw), [raw]);
  const write = useCallback((next: NavSelection) => {
    if (!key) return;
    const text = serializeSelection(next);
    memory.set(key, text);
    try { window.sessionStorage.setItem(key, text); } catch { /* só em memória nesta aba */ }
    listeners.forEach(listener => listener());
  }, [key]);
  return [selection ?? EMPTY_SELECTION, write];
}
