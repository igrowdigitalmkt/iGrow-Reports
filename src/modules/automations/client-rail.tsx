"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { ClientItem } from "@/modules/clients/schema";

export type RailInfo = { detail: string; count?: number; tone?: "on" | "warn" | "off" };

/** Client list used to split a page by client (Agendamentos, Entregas). */
export function ClientRail({ clients, selectedId, onSelect, info, title }: {
  clients: ClientItem[]; selectedId: string | null; onSelect: (id: string) => void; info: (id: string) => RailInfo; title: string;
}) {
  const [query, setQuery] = useState("");
  const visible = clients.filter(client => !query || client.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <nav className="client-rail panel" aria-label={title}>
    <div className="client-rail-head"><span>{title}</span><small>{clients.length}</small></div>
    {clients.length > 8 && <label className="client-rail-search"><Search size={14} /><input className="input" placeholder="Buscar cliente" value={query} onChange={event => setQuery(event.target.value)} aria-label="Buscar cliente" /></label>}
    <ul>
      {visible.map(client => {
        const meta = info(client.id);
        return <li key={client.id}>
          <button type="button" aria-current={client.id === selectedId ? "true" : undefined} onClick={() => onSelect(client.id)}>
            <span className={`client-rail-dot is-${meta.tone ?? "off"}`} aria-hidden="true" />
            <span className="client-rail-name"><strong>{client.name}</strong><small>{meta.detail}</small></span>
            {!!meta.count && <span className="client-rail-count">{meta.count}</span>}
          </button>
        </li>;
      })}
      {!visible.length && <li className="client-rail-empty">{clients.length ? "Nenhum cliente com esse nome." : "Nenhum cliente cadastrado."}</li>}
    </ul>
  </nav>;
}

/** Keeps the chosen client in the address (?cliente=) without reloading the page. */
export function rememberClient(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("cliente", id);
  window.history.replaceState(window.history.state, "", url);
}
