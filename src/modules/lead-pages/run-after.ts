import "server-only";

import { after } from "next/server";

/** Roda depois de responder (sem atrasar a resposta ao webhook). Fora de uma requisição (testes, scripts), roda na hora. */
export function runAfter(task: () => Promise<unknown>): void {
  const safe = () => task().catch(error => { console.error("lead-after-task-failed", error instanceof Error ? error.message : "erro"); });
  try { after(safe); } catch { void safe(); }
}
