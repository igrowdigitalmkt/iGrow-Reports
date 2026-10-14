"use client";

import type { ReactNode } from "react";
import { CheckCircle2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./connected-card.css";

// Padrão das integrações conectadas: um cartão com a identidade da conexão e o botão "Desconectar" à direita.
// Toda integração (WhatsApp, Meta, Google Ads…) usa estes dois blocos, para o usuário achar a ação sempre no mesmo lugar.

export function DisconnectButton({ message, onConfirm, disabled, label = "Desconectar" }: { message: string; onConfirm: () => void; disabled?: boolean; label?: string }) {
  return <Button variant="secondary" size="sm" disabled={disabled} onClick={() => { if (window.confirm(message)) onConfirm(); }}><LogOut size={14} />{label}</Button>;
}

export function ConnectedCard({ title, detail, note, picture, action }: { title: string; detail?: string | null; note?: string; picture?: string | null; action?: ReactNode }) {
  return <div className="connected-card">
    {/* eslint-disable-next-line @next/next/no-img-element -- foto de perfil externa e de vida curta */}
    {picture ? <img src={picture} alt="" className="connected-card-avatar" referrerPolicy="no-referrer" /> : <span className="connected-card-avatar"><CheckCircle2 size={22} /></span>}
    <div><strong>{title}</strong>{detail ? <span>{detail}</span> : null}{note ? <small>{note}</small> : null}</div>
    {action}
  </div>;
}
