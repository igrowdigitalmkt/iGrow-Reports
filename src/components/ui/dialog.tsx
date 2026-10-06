"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Dialog({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className={wide ? "dialog-content is-wide" : "dialog-content"}>
        <DialogPrimitive.Title className="text-xl font-semibold pr-8">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="muted mt-2 text-sm">{description ?? "Informações da plataforma iGrow Reports."}</DialogPrimitive.Description>
        <DialogPrimitive.Close className="dialog-close icon-button" aria-label="Fechar"><X size={19} /></DialogPrimitive.Close>
        <div className="mt-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

