"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, RotateCcw, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setClientPortalAccessByEmail } from "./actions";
import type { ClientPortalAdminAccess } from "./types";

type Props = {
  agencyId: string;
  clientId: string;
  clientName: string;
  archived: boolean;
  initialAccesses: ClientPortalAdminAccess[];
};

export function ClientAccessManager({
  agencyId,
  clientId,
  clientName,
  archived,
  initialAccesses,
}: Props) {
  const [rows, setRows] = useState(initialAccesses);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);

  function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await setClientPortalAccessByEmail({
        agencyId,
        clientId,
        email: normalized,
        active: true,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const now = new Date().toISOString();
      setRows((current) => {
        const existing = current.find((row) => row.email.toLowerCase() === normalized);
        if (existing) {
          return current.map((row) =>
            row.email.toLowerCase() === normalized
              ? { ...row, active: true, userId: result.userId ?? row.userId, updatedAt: now }
              : row,
          );
        }
        return [
          ...current,
          {
            clientId,
            userId: result.userId ?? "",
            email: normalized,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        ].sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
      });
      setEmail("");
      setNotice("Acesso liberado para a Área do Cliente.");
    });
  }

  function changeAccess(row: ClientPortalAdminAccess, active: boolean) {
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await setClientPortalAccessByEmail({
        agencyId,
        clientId,
        email: row.email,
        active,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const now = new Date().toISOString();
      setRows((current) =>
        current.map((item) =>
          item.email === row.email
            ? { ...item, active, userId: result.userId ?? item.userId, updatedAt: now }
            : item,
        ),
      );
      setNotice(active ? "Acesso reativado." : "Acesso revogado.");
    });
  }

  return (
    <div className="space-y-5">
      <div className="info-banner mb-0">
        <ShieldCheck size={18} />
        <p>
          O acesso é individual e restrito a <strong>{clientName}</strong>. A conta informada precisa existir no iGrow Reports e estar com o e-mail confirmado.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <strong className="text-sm font-semibold">Usuários autorizados</strong>
          <p className="muted mt-1 text-xs">{activeCount} acesso(s) ativo(s)</p>
        </div>
        <span className="badge neutral">{rows.length} vínculo(s)</span>
      </div>

      <div className="space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.userId || row.email} className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-3">
            <span className={row.active ? "green flex h-8 w-8 items-center justify-center rounded-md" : "neutral flex h-8 w-8 items-center justify-center rounded-md"}>
              {row.active ? <CheckCircle2 size={16} /> : <UserMinus size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-medium">{row.email}</strong>
              <small className="muted mt-0.5 block">{row.active ? "Acesso ativo" : "Acesso revogado"}</small>
            </div>
            <button
              type="button"
              className="button button-secondary button-sm"
              disabled={pending || (archived && !row.active)}
              onClick={() => changeAccess(row, !row.active)}
            >
              {row.active ? <UserMinus size={14} /> : <RotateCcw size={14} />}
              {row.active ? "Revogar" : "Reativar"}
            </button>
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-5 text-center">
            <UserPlus className="muted mx-auto" size={20} />
            <strong className="mt-2 block text-sm font-medium">Nenhum acesso liberado</strong>
            <p className="muted mt-1 text-xs">Adicione a conta do cliente pelo e-mail usado no login.</p>
          </div>
        )}
      </div>

      <form onSubmit={grant} className="border-t border-[var(--border)] pt-5">
        <label className="block text-sm font-medium" htmlFor={`portal-email-${clientId}`}>
          Liberar novo acesso
        </label>
        <p className="muted mt-1 text-xs">Use exatamente o e-mail da conta autenticada do cliente.</p>
        <div className="mt-3 flex gap-2">
          <input
            id={`portal-email-${clientId}`}
            className="input min-w-0 flex-1"
            type="email"
            autoComplete="email"
            placeholder="cliente@empresa.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending || archived}
            required
          />
          <Button type="submit" disabled={pending || archived || !email.trim()}>
            <UserPlus size={15} />
            {pending ? "Salvando…" : "Liberar"}
          </Button>
        </div>
        {archived && <p className="mt-3 text-xs text-amber-400">Reative o cliente antes de conceder novos acessos.</p>}
      </form>

      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}
    </div>
  );
}
