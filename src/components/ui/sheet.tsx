"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

// Side panel for detailed settings, keeping the page behind it compact.
export function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="sheet-content">
        <header className="sheet-head">
          <div>
            <DialogPrimitive.Title className="sheet-title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sheet-description">{description ?? "Configurações da integração."}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="icon-button" aria-label="Fechar"><X size={19} /></DialogPrimitive.Close>
        </header>
        <div className="sheet-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
