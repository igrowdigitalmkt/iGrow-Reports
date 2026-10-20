"use client";

import { useSyncExternalStore } from "react";

/**
 * Preferências LOCAIS de interface (localStorage): leitura sem setState em efeito (useSyncExternalStore). No servidor e na hidratação o
 * valor é `null`; depois da hidratação vem o valor salvo. Armazenamento indisponível (janela privada, bloqueio) nunca gera erro.
 */
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); window.addEventListener("storage", listener); return () => { listeners.delete(listener); window.removeEventListener("storage", listener); }; };

export function writeLocalPreference(key: string, value: string | null) {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* armazenamento indisponível */ }
  listeners.forEach(listener => listener());
}

export function useLocalPreference(key: string | null): string | null {
  return useSyncExternalStore(subscribe, () => { if (!key) return null; try { return window.localStorage.getItem(key); } catch { return null; } }, () => null);
}

const noSubscription = () => () => {};
/** `false` no servidor e na hidratação; `true` depois. */
export const useHydrated = () => useSyncExternalStore(noSubscription, () => true, () => false);
