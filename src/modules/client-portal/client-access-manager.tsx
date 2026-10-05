"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { CheckCircle2, Clock3, Mail, RotateCcw, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inviteClientPortalUser, revokeClientPortalInvitation, setClientPortalAccessByEmail } from "./actions";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "./types";

type Props = {
  agencyId: string;
  clientId: string;
  clientName: string;
  archived: boolean;
  initialAccesses: ClientPortalAdminAccess[];
  initialInvitations?: ClientPortalPendingInvitation[];
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function ClientAccessManager({
  agencyId,
  clientId,
  clientName,
  archived,
  initialAccesses,
  initialInvitations = [],
}: Props) {
  const [rows, setRows] = useState(initialAccesses);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await inviteClientPortalUser({ agencyId, clientId, email: normalized });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEmail("");
      if (result.status === "active") {
        setNotice("Este e-mail já tem acesso ativo à Área do Cliente.");
        return;
      }
      const invitation = result.invitation;
      if (invitation) {
        setInvitations((current) => [
          ...current.filter((item) => item.email !== invitation.email),
          { ...invitation, clientId },
        ].sort((a, b) => a.email.localeCompare(b.email, "pt-BR")));
      }
      setNotice(result.status === "invited"
        ? `Convite enviado para ${normalized}. O acesso fica ativo quando a pessoa criar a senha pelo link do e-mail.`
        : `${normalized} já tem conta: enviamos um link de acesso. O acesso fica ativo quando a pessoa abrir o link.`);
    });
  }

  function cancelInvitation(invitation: ClientPortalPendingInvitation) {
    setError("");
    setNotice("");
    startTransition(async () => {
      const result = await revokeClientPortalInvitation({ agencyId, invitationId: invitation.id });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      setNotice("Convite cancelado. O link enviado não libera mais o acesso.");
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
          O acesso é individual e restrito a <strong>{clientName}</strong>. Convide pelo e-mail: o acesso fica ativo quando a pessoa criar a senha pelo convite ou, se já tiver conta, abrir o link recebido.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <strong className="text-sm font-semibold">Usuários autorizados</strong>
          <p className="muted mt-1 text-xs">{activeCount} acesso(s) ativo(s){invitations.length ? ` · ${invitations.length} convite(s) pendente(s)` : ""}</p>
        </div>
        <span className="badge neutral">{rows.length} vínculo(s)</span>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
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
        ))}
        {invitations.map((invitation) => (
          <div key={invitation.id} className="flex items-center gap-3 rounded-md border border-dashed border-[var(--border)] px-3 py-3">
            <span className="neutral flex h-8 w-8 items-center justify-center rounded-md"><Clock3 size={16} /></span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-medium">{invitation.email}</strong>
              <small className="muted mt-0.5 block">Convite pendente · válido até {dateFormat.format(new Date(invitation.expiresAt))}</small>
            </div>
            <button type="button" className="button button-secondary button-sm" disabled={pending} onClick={() => cancelInvitation(invitation)}>
              <X size={14} />
              Cancelar
            </button>
          </div>
        ))}
        {!rows.length && !invitations.length && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-5 text-center">
            <UserPlus className="muted mx-auto" size={20} />
            <strong className="mt-2 block text-sm font-medium">Nenhum acesso liberado</strong>
            <p className="muted mt-1 text-xs">Convide a pessoa pelo e-mail que ela vai usar para entrar.</p>
          </div>
        )}
      </div>

      <form onSubmit={invite} className="border-t border-[var(--border)] pt-5">
        <label className="block text-sm font-medium" htmlFor={`portal-email-${clientId}`}>
          Convidar para a Área do Cliente
        </label>
        <p className="muted mt-1 text-xs">Enviamos um e-mail com o link de acesso. Convidar de novo reenvia o link; o convite vale por 7 dias.</p>
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
            <Mail size={15} />
            {pending ? "Enviando…" : "Convidar"}
          </Button>
        </div>
        {archived && <p className="mt-3 text-xs text-amber-400">Reative o cliente antes de conceder novos acessos.</p>}
      </form>

      {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-500">{notice}</p>}
    </div>
  );
}
