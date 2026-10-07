"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MailCheck, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { roleLabels } from "@/modules/agencies/roles";
import type { AgencyRole } from "@/types/database";
import { inviteMemberAction, removeMemberAction, revokeInvitationAction, setMemberModulesAction, setMemberRoleAction } from "./actions";
import type { TeamMember, TeamSnapshot } from "./admin";
import { ROLE_HINTS, TEAM_MODULES } from "./permissions";

const ROLES: AgencyRole[] = ["owner", "admin", "editor", "viewer"];
const initialsOf = (value: string) => value.split(/[ @._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

// Team of the workspace: who is in, what each role can do and which areas each member opens.
export function TeamView({ snapshot, currentUserId, currentRole, timezone, demo = false }: { snapshot: TeamSnapshot; currentUserId: string; currentRole: AgencyRole; timezone: string; demo?: boolean }) {
  const router = useRouter();
  const canManage = currentRole === "owner" || currentRole === "admin";
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  const [permissionsOf, setPermissionsOf] = useState<TeamMember | null>(null);
  const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone });

  function act(task: () => Promise<{ error?: string } | { success: true }>) {
    setError("");
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    start(async () => {
      const result = await task();
      if ("error" in result && result.error) setError(result.error);
      router.refresh();
    });
  }
  const manageable = (member: TeamMember) => canManage && member.userId !== currentUserId && !(currentRole === "admin" && member.role === "owner");

  if (!snapshot.ready) return <section className="panel empty-state"><Users size={22} /><h3>Equipe ainda não disponível</h3><p>O banco de dados precisa receber a atualização de equipe e permissões. Assim que ela for aplicada, esta página passa a funcionar.</p></section>;

  return <div className="team">
    <div className="section-toolbar">
      <span className="muted text-sm">{snapshot.members.length} {snapshot.members.length === 1 ? "membro" : "membros"}{snapshot.invitations.length ? ` · ${snapshot.invitations.length} ${snapshot.invitations.length === 1 ? "convite pendente" : "convites pendentes"}` : ""}</span>
      {canManage && <Button onClick={() => setInviting(true)}><UserPlus size={16} />Convidar membro</Button>}
    </div>
    {error && <p role="alert" className="meta-feedback error">{error}</p>}

    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="table-scroll"><table className="data-table team-table">
        <caption className="sr-only">Membros da equipe</caption>
        <thead><tr><th scope="col">Membro</th><th scope="col">Papel</th><th scope="col">Acesso às áreas</th><th scope="col">Último acesso</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{snapshot.members.map(member => {
          const full = member.role === "owner" || member.role === "admin" || !member.modules;
          return <tr key={member.userId}>
            <th scope="row" style={{ fontWeight: 400 }}><div className="client-cell">
              {/* eslint-disable-next-line @next/next/no-img-element -- small profile photo */}
              {member.avatarUrl ? <img className="client-avatar team-avatar" src={member.avatarUrl} alt="" /> : <span className="client-avatar blue">{initialsOf(member.name ?? member.email)}</span>}
              <span style={{ minWidth: 0 }}><strong>{member.name ?? member.email.split("@")[0]}{member.userId === currentUserId && <span className="badge neutral team-you">Você</span>}</strong><small>{member.email}</small></span>
            </div></th>
            <td>{manageable(member)
              ? <select className="input compact-select" aria-label={`Papel de ${member.email}`} value={member.role} disabled={busy} onChange={event => act(() => setMemberRoleAction({ userId: member.userId, role: event.target.value }))}>
                {ROLES.filter(role => currentRole === "owner" || role !== "owner").map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
              : <span className="badge neutral">{roleLabels[member.role]}</span>}</td>
            <td><div className="team-access">
              <span>{full ? "Todas as áreas" : `${member.modules!.length} de ${TEAM_MODULES.length} áreas`}</span>
              {manageable(member) && member.role !== "owner" && member.role !== "admin" && <button type="button" className="text-link" onClick={() => setPermissionsOf(member)}>Permissões</button>}
            </div></td>
            <td className="muted">{member.lastSignInAt ? date.format(new Date(member.lastSignInAt)) : "Ainda não acessou"}</td>
            <td><div className="row-actions">{manageable(member) && <button type="button" className="icon-button" aria-label={`Remover ${member.email}`} title="Remover da equipe" onClick={() => { if (window.confirm(`Remover ${member.email} da equipe? A pessoa perde o acesso a este espaço de trabalho.`)) act(() => removeMemberAction({ userId: member.userId })); }}><Trash2 size={16} /></button>}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    {canManage && snapshot.invitations.length > 0 && <section className="panel">
      <div className="panel-heading"><div><h2>Convites pendentes</h2><p>A pessoa entra na equipe ao acessar com o e-mail convidado</p></div></div>
      <ul className="run-list">{snapshot.invitations.map(invite => <li key={invite.id}>
        <span className="reports-overview-icon"><MailCheck size={15} /></span>
        <span className="run-list-main"><strong>{invite.email}</strong><small>{roleLabels[invite.role]} · válido até {date.format(new Date(invite.expiresAt))}</small></span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => revokeInvitationAction({ id: invite.id }))}>Cancelar convite</Button>
      </li>)}</ul>
    </section>}

    <section className="panel team-roles">
      <div className="panel-heading"><div><h2>O que cada papel pode fazer</h2><p>Editores e leitores podem ainda ter as áreas limitadas em Permissões</p></div><Shield size={18} className="muted" /></div>
      <dl>{ROLES.map(role => <div key={role}><dt>{roleLabels[role]}</dt><dd>{ROLE_HINTS[role]}</dd></div>)}</dl>
    </section>

    <InviteDialog open={inviting} onOpenChange={setInviting} currentRole={currentRole} demo={demo} onDone={() => router.refresh()} />
    {permissionsOf && <PermissionsDialog member={permissionsOf} onClose={() => setPermissionsOf(null)} onSave={modules => act(async () => { const result = await setMemberModulesAction({ userId: permissionsOf.userId, modules }); setPermissionsOf(null); return result; })} />}
  </div>;
}

function InviteDialog({ open, onOpenChange, currentRole, demo, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; currentRole: AgencyRole; demo: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AgencyRole>("editor");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function reset(next: boolean) { onOpenChange(next); if (!next) { setEmail(""); setError(""); setResult(null); setCopied(false); } }
  function send() {
    setError("");
    if (demo) { setError("Na demonstração nenhum convite é enviado."); return; }
    start(async () => {
      const response = await inviteMemberAction({ email, role });
      if ("error" in response) { setError(response.error ?? "Não foi possível convidar."); return; }
      setResult({ link: response.link, emailed: response.emailed });
      onDone();
    });
  }

  return <Dialog open={open} onOpenChange={reset} title="Convidar membro" description="A pessoa recebe um e-mail e entra na equipe ao acessar com esse endereço.">
    {result ? <div className="team-invite-result">
      <p>{result.emailed ? <>Convite enviado para <strong>{email}</strong>.</> : <>O convite foi criado, mas o e-mail não pôde ser enviado agora. Envie o link abaixo para <strong>{email}</strong>.</>}</p>
      <label><span>Link do convite (válido por 7 dias)</span><div className="team-link"><input className="input" readOnly value={result.link} onFocus={event => event.currentTarget.select()} /><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(result.link).then(() => setCopied(true)); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copiado" : "Copiar"}</Button></div></label>
      <Button className="w-full" onClick={() => reset(false)}>Concluir</Button>
    </div> : <form className="template-save-form" onSubmit={event => { event.preventDefault(); send(); }}>
      <label><span>E-mail</span><input className="input" type="email" autoFocus required value={email} onChange={event => setEmail(event.target.value)} placeholder="nome@empresa.com.br" /></label>
      <fieldset className="team-role-options"><legend>Papel</legend>{(["admin", "editor", "viewer", ...(currentRole === "owner" ? ["owner"] as AgencyRole[] : [])] as AgencyRole[]).map(option => <label key={option} className={role === option ? "is-selected" : undefined}>
        <input type="radio" name="role" checked={role === option} onChange={() => setRole(option)} />
        <span><strong>{roleLabels[option]}</strong><small>{ROLE_HINTS[option]}</small></span>
      </label>)}</fieldset>
      {error && <p role="alert" className="meta-feedback error">{error}</p>}
      <div className="template-save-actions"><Button type="button" variant="secondary" onClick={() => reset(false)}>Cancelar</Button><Button type="submit" disabled={pending || !email.includes("@")}>{pending ? "Enviando…" : "Enviar convite"}</Button></div>
    </form>}
  </Dialog>;
}

function PermissionsDialog({ member, onClose, onSave }: { member: TeamMember; onClose: () => void; onSave: (modules: string[]) => void }) {
  const [modules, setModules] = useState<string[]>(member.modules ?? TEAM_MODULES.map(module => module.key));
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} title={`Permissões · ${member.name ?? member.email}`} description="Escolha as áreas que esta pessoa pode abrir. Configurações pessoais ficam sempre disponíveis.">
    <div className="team-modules">{TEAM_MODULES.map(module => <label key={module.key}>
      <input type="checkbox" checked={modules.includes(module.key)} onChange={() => setModules(current => current.includes(module.key) ? current.filter(key => key !== module.key) : [...current, module.key])} />
      <span><strong>{module.label}</strong><small>{module.hint}</small></span>
    </label>)}</div>
    <div className="template-save-actions"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => onSave(modules)}>Salvar permissões</Button></div>
  </Dialog>;
}
