"use client";

/** Interruptor Ativado/Desativado da plataforma (o mesmo visual do Status das campanhas). */
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`status-switch${checked ? " is-on" : ""}`}
    onClick={() => onChange(!checked)}><i aria-hidden="true" /></button>;
}
