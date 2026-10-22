"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS, SettingsPanel, type SettingsSectionKey } from "@/modules/operations/settings-panels";
import type { WorkspaceIdentity } from "./app-shell";

/** Configurações em popup grande, com menu lateral (as seções restritas a administradores só aparecem para eles). */
export function SettingsDialog({ open, onOpenChange, identity, demo }: { open: boolean; onOpenChange: (open: boolean) => void; identity: WorkspaceIdentity; demo: boolean }) {
  const [section, setSection] = useState<SettingsSectionKey>("perfil");
  const canAdmin = !!identity.canAdmin;
  const sections = SETTINGS_SECTIONS.filter(item => !item.adminOnly || (canAdmin && !demo));
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="settings-dialog" aria-describedby={undefined}>
        <DialogPrimitive.Title className="sr-only">Configurações</DialogPrimitive.Title>
        <DialogPrimitive.Close className="dialog-close icon-button" aria-label="Fechar"><X size={19} /></DialogPrimitive.Close>
        <nav className="settings-dialog-nav" aria-label="Seções de configurações">
          <h2>Configurações</h2>
          {sections.map(item => <button key={item.key} type="button" className={cn("settings-dialog-item", item.key === section && "is-active")} aria-current={item.key === section ? "page" : undefined} onClick={() => setSection(item.key)}>{item.label}</button>)}
        </nav>
        <div className="settings-dialog-body">
          <SettingsPanel section={sections.some(item => item.key === section) ? section : "perfil"} identity={identity} demo={demo} agencyId={identity.agencyId} canAdmin={canAdmin} />
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
