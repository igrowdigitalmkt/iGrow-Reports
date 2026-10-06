"use client";

import { useRef } from "react";
import { CircleAlert } from "lucide-react";
import { MESSAGE_VARIABLES, unknownVariables } from "@/modules/automations/message";

const GROUPS = ["Geral", "Investimento", "Alcance", "Resultados", "Custos"] as const;

// Message text with variable buttons that insert {{chave}} at the cursor.
export function MessageComposer({ value, onChange, rows = 12, label = "Texto da mensagem" }: { value: string; onChange: (value: string) => void; rows?: number; label?: string }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const unknown = unknownVariables(value);

  function insert(key: string) {
    const element = textarea.current;
    const token = `{{${key}}}`;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length); });
  }

  return <div className="message-composer">
    <div className="variable-groups">{GROUPS.map(group => <div key={group} className="variable-group">
      <span>{group}</span>
      <div>{MESSAGE_VARIABLES.filter(variable => variable.group === group).map(variable =>
        <button key={variable.key} type="button" className="variable-chip" title={`Insere {{${variable.key}}}`} onClick={() => insert(variable.key)}>{variable.label}</button>)}</div>
    </div>)}</div>
    <textarea ref={textarea} className="input automation-message" rows={rows} value={value} maxLength={4000} onChange={event => onChange(event.target.value)} aria-label={label} />
    <div className="automation-message-foot">
      {unknown.length ? <span className="is-warn"><CircleAlert size={14} />Variável desconhecida: {unknown.map(key => `{{${key}}}`).join(", ")}</span> : <span>Use *asteriscos* para negrito e _sublinhados_ para itálico, como no WhatsApp.</span>}
      <span>{value.length}/4000</span>
    </div>
  </div>;
}
