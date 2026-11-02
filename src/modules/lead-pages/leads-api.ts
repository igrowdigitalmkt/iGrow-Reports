"use client";

import { addLeadNoteAction, setLeadStatusAction } from "./hub-actions";
import { filtersToQuery, type LeadEvent, type LeadFilters, type LeadsBoardData, type LeadStatus } from "./hub-types";

/** Como a tela fala com o servidor. A tela é a mesma no menu do cliente, no portal e no link compartilhado: só muda o adaptador. */
export type BoardApi = {
  load: (filters: LeadFilters) => Promise<LeadsBoardData & { canUpdate?: boolean }>;
  events: (leadId: string) => Promise<LeadEvent[]>;
  setStatus: (leadId: string, status: LeadStatus) => Promise<boolean>;
  addNote: (leadId: string, body: string) => Promise<boolean>;
};

async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

/** Por sessão (equipe da organização ou cliente logado no portal). */
export const sessionApi = (clientId: string): BoardApi => ({
  load: filters => getJson(`/api/leads/clients/${clientId}?${filtersToQuery(filters)}`),
  events: async leadId => (await getJson<{ events: LeadEvent[] }>(`/api/leads/clients/${clientId}?historico=${leadId}`)).events,
  setStatus: async (leadId, status) => (await setLeadStatusAction({ clientId, leadId, status })).ok,
  addNote: async (leadId, body) => (await addLeadNoteAction({ clientId, leadId, body })).ok,
});

/** Por link compartilhado (sem login): o código vai sempre no cabeçalho. */
export const sharedApi = (code: string): BoardApi => {
  const headers = { "x-lead-code": code };
  const post = async (payload: Record<string, unknown>) => (await fetch("/api/leads/shared", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload) })).ok;
  return {
    load: filters => getJson(`/api/leads/shared?${filtersToQuery(filters)}`, headers),
    events: async leadId => (await getJson<{ events: LeadEvent[] }>(`/api/leads/shared?historico=${leadId}`, headers)).events,
    setStatus: (leadId, status) => post({ action: "status", leadId, status }),
    addNote: (leadId, body) => post({ action: "note", leadId, body }),
  };
};
