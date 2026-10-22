"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { LogOut, CircleHelp, Moon, Settings2, Sun, SunMoon } from "lucide-react";
import { logoutAction } from "@/modules/auth/actions";
import type { WorkspaceIdentity } from "./app-shell";

const subscribeToHydration = () => () => {};
const initialsOf = (value: string) => value.split(/[ @._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export function Avatar({ identity, size = 32 }: { identity: WorkspaceIdentity; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- small profile photo from storage
  if (identity.avatarUrl) return <img className="user-avatar" style={{ width: size, height: size }} src={identity.avatarUrl} alt="" />;
  return <span className="user-avatar" style={{ width: size, height: size, fontSize: Math.round(size * .38) }}>{initialsOf(identity.userName) || "IG"}</span>;
}

/** Avatar no canto superior direito: abre o menu da conta (Configurações, tema, ajuda e sair). */
export function UserMenu({ identity, demo, onSettings, onHelp }: { identity: WorkspaceIdentity; demo: boolean; onSettings: () => void; onHelp: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const dark = resolvedTheme !== "light";

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);

  const choose = (action: () => void) => () => { setOpen(false); action(); };
  return <div className="user-menu" ref={root}>
    <button type="button" className="user-menu-trigger" onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open} aria-label={`Menu da conta de ${identity.userName}`}>
      <Avatar identity={identity} />
    </button>
    {open && <div className="user-menu-panel" role="menu" aria-label="Menu da conta">
      <div className="user-menu-head">
        <Avatar identity={identity} size={40} />
        <div><strong>{identity.userName}</strong>{identity.email && <small>{identity.email}</small>}<small>{identity.roleLabel} · {identity.agencyName}</small></div>
      </div>
      <div className="user-menu-list">
        <button type="button" role="menuitem" onClick={choose(onSettings)}><Settings2 size={17} />Configurações</button>
        <button type="button" role="menuitem" onClick={() => setTheme(dark ? "light" : "dark")}>{!hydrated ? <SunMoon size={17} /> : dark ? <Sun size={17} /> : <Moon size={17} />}{!hydrated ? "Mudar tema" : dark ? "Tema claro" : "Tema escuro"}</button>
        <button type="button" role="menuitem" onClick={choose(onHelp)}><CircleHelp size={17} />Central de ajuda</button>
      </div>
      <div className="user-menu-list is-last">
        {demo
          ? <Link role="menuitem" href="/entrar" onClick={() => setOpen(false)}><LogOut size={17} />Acessar meu espaço</Link>
          : <form action={logoutAction}><button type="submit" role="menuitem"><LogOut size={17} />Sair da conta</button></form>}
      </div>
    </div>}
  </div>;
}
