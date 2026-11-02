"use client";

import { useMemo } from "react";
import { Brand } from "@/components/layout/brand";
import { sharedApi } from "./leads-api";
import { LeadsBoard } from "./leads-board";
import type { LeadsBoardData } from "./hub-types";
import "./lead-feed.css";

/** Página do link compartilhado: sem login, sem menu, só o painel de leads do cliente (com o escopo de formulários do link). */
export function SharedLeadsView({ code, clientName, initial, canUpdate }: { code: string; clientName: string; initial: LeadsBoardData; canUpdate: boolean }) {
  const api = useMemo(() => sharedApi(code), [code]);
  return <main className="lead-page">
    <header className="lead-header"><Brand /></header>
    <h1 className="lead-title">{clientName} · Leads</h1>
    <LeadsBoard initial={initial} api={api} canUpdate={canUpdate} />
    <footer className="lead-foot">Página privada. Não compartilhe este endereço fora da sua equipe: ele dá acesso aos contatos recebidos.</footer>
  </main>;
}
