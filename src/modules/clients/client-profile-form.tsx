"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { getClientAiEnabled, setClientAiEnabled } from "@/modules/ai/settings-actions";
import { getClientProfile, saveClientProfile } from "./profile-actions";
import { EMPTY_PROFILE, PROFILE_FIELDS, PROFILE_NUDGE, profileCompleteness, type ClientProfile } from "./profile";

type Props = { demo: boolean; agencyId?: string; clientId: string; canEdit: boolean; archived: boolean };

export function ClientProfileForm({ demo, agencyId, clientId, canEdit, archived }: Props) {
  const [profile, setProfile] = useState<ClientProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const allowed = (demo || canEdit) && !archived;
  const progress = profileCompleteness(profile);

  useEffect(() => {
    if (demo || !agencyId) return;
    let live = true;
    getClientProfile({ agencyId, clientId }).then(result => {
      if (!live) return;
      if ("error" in result) setError(result.error); else setProfile(result.profile);
    }).catch(() => { if (live) setError("Não foi possível carregar. Feche e reabra este painel para tentar novamente."); })
      .finally(() => { if (live) setLoading(false); });
    getClientAiEnabled({ agencyId, clientId }).then(result => { if (live && !("error" in result)) setAiEnabled(result.enabled); }).catch(() => undefined);
    return () => { live = false; };
  }, [demo, agencyId, clientId]);

  function toggleAi(enabled: boolean) {
    if (!agencyId) return;
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await setClientAiEnabled({ agencyId, clientId, enabled });
        if ("error" in result) { setError(result.error); return; }
        setAiEnabled(result.enabled); setNotice(result.enabled ? "IA ligada para este cliente." : "IA desligada para este cliente.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(PROFILE_FIELDS.map(item => [item.key, String(form.get(item.key) ?? "")]));
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        if (demo || !agencyId) { setProfile(values as unknown as ClientProfile); setNotice("Simulação atualizada. Nada foi gravado no banco."); return; }
        const result = await saveClientProfile({ agencyId, clientId, ...values });
        if ("error" in result) { setError(result.error); return; }
        setProfile(result.profile); setNotice("Perfil salvo.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }

  if (loading) return <p className="muted text-sm">Carregando perfil…</p>;
  return <form onSubmit={submit} key={`${clientId}-${progress.filled}`}>
    <p className="muted text-sm">Tudo é opcional. Preencha só o que o cliente já compartilhou: a IA usa essas informações para entender o negócio e comentar os resultados com mais precisão. Não coloque dados pessoais de contatos.</p>
    <p className="info-banner" role="status">
      {progress.complete ? "Perfil completo." : `${progress.filled} de ${progress.total} campos preenchidos. ${PROFILE_NUDGE}`}
    </p>
    {PROFILE_FIELDS.map((item, index) => <div key={item.key}>
      <label className={`block text-sm ${index ? "mt-4" : "mt-2"}`} htmlFor={`profile-${item.key}`}>{item.label}</label>
      {item.multiline
        ? <textarea id={`profile-${item.key}`} name={item.key} className="input mt-2" rows={2} maxLength={item.max} defaultValue={profile[item.key] ?? ""} placeholder={item.placeholder} disabled={pending || !allowed} />
        : <input id={`profile-${item.key}`} name={item.key} className="input mt-2" maxLength={item.max} defaultValue={profile[item.key] ?? ""} placeholder={item.placeholder} disabled={pending || !allowed} />}
    </div>)}
    {error && <p role="alert" className="mt-4 text-rose-400 text-sm">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
    {allowed && <Button className="mt-6 w-full" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar perfil"}</Button>}
    {!demo && aiEnabled !== null && <label className="flex items-center gap-3 text-sm mt-6"><input type="checkbox" checked={aiEnabled} disabled={pending || !allowed} onChange={event => toggleAi(event.target.checked)} />Usar IA para gerar comentários deste cliente</label>}
  </form>;
}
