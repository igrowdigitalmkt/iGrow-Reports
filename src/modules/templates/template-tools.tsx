"use client";

import { useState, useTransition } from "react";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SYSTEM_TEMPLATES } from "@/modules/automations/message";
import { saveMessageTemplateAction } from "./actions";
import type { SavedTemplate } from "./types";

/** "Escolher template": the platform's ready-made ones and the workspace's own. */
export function TemplatePicker({ saved, onPick, className }: { saved: SavedTemplate[]; onPick: (body: string, name: string) => void; className?: string }) {
  return <select className={className ?? "input compact-select"} aria-label="Escolher template" value="" onChange={event => {
    const id = event.target.value;
    const template = SYSTEM_TEMPLATES.find(item => item.id === id) ?? saved.find(item => item.id === id);
    if (template) onPick(template.body, template.name);
  }}>
    <option value="">Escolher template…</option>
    {saved.some(item => item.channel === "whatsapp") && <optgroup label="Seus templates">{saved.filter(item => item.channel === "whatsapp").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
    <optgroup label="Prontos da plataforma">{SYSTEM_TEMPLATES.filter(item => item.channel === "whatsapp").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>
  </select>;
}

/** "Salvar como template": keeps the current message for reuse with other clients. */
export function SaveTemplateButton({ body, demo = false, onSaved }: { body: string; demo?: boolean; onSaved?: (template: SavedTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, start] = useTransition();

  function save() {
    setError("");
    if (demo) { setError("Na demonstração nada é salvo."); return; }
    start(async () => {
      const result = await saveMessageTemplateAction({ name, channel: "whatsapp", body });
      if ("error" in result) { setError(result.error ?? "Não foi possível salvar."); return; }
      setDone(`Template "${result.template.name}" salvo.`);
      onSaved?.(result.template);
      setOpen(false);
    });
  }

  return <>
    <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(true); setError(""); setDone(""); }}><BookmarkPlus size={14} />Salvar como template</Button>
    {done && <span className="template-saved-note" role="status">{done}</span>}
    <Dialog open={open} onOpenChange={setOpen} title="Salvar como template" description="A mensagem fica disponível em Escolher template para qualquer cliente.">
      <form className="template-save-form" onSubmit={event => { event.preventDefault(); save(); }}>
        <label><span>Nome do template</span><input className="input" autoFocus value={name} maxLength={80} placeholder="Ex.: Vendas semanais da loja" onChange={event => setName(event.target.value)} /></label>
        {error && <p role="alert" className="meta-feedback error">{error}</p>}
        <div className="template-save-actions">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit" disabled={pending || name.trim().length < 2}>{pending ? "Salvando…" : "Salvar template"}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
