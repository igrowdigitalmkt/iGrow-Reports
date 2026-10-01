import Link from "next/link";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "@/components/layout/brand";
import { logoutAction } from "@/modules/auth/actions";

type ClientPortalShellProps = {
  children: ReactNode;
  title: string;
  description: string;
  userEmail: string | undefined;
  showClientSwitcher?: boolean;
  agencyMode?: boolean;
};

export function ClientPortalShell({
  children,
  title,
  description,
  userEmail,
  showClientSwitcher = false,
  agencyMode = false,
}: ClientPortalShellProps) {
  return (
    <main className="client-portal">
      <header className="client-topbar">
        <div className="client-topbar-inner">
          <Link href={agencyMode ? "/dashboard/clientes" : "/cliente"} aria-label="iGrow Reports — Área do Cliente" className="client-brand-link">
            <Brand />
          </Link>
          <div className="client-topbar-actions">
            {agencyMode && (
              <Link href="/dashboard/clientes" className="client-topbar-link">
                <ArrowLeft size={14} /> Voltar aos clientes
              </Link>
            )}
            {showClientSwitcher && (
              <Link href="/cliente" className="client-topbar-link">
                Trocar cliente
              </Link>
            )}
            <span className="client-account">{userEmail ?? "Conta autenticada"}</span>
            <form action={logoutAction}>
              <button className="client-logout">
                <LogOut size={14} />
                <span>Sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="client-container">
        <div className="client-page-heading">
          <span className="client-kicker">
            <ShieldCheck size={13} />
            {agencyMode ? "Visão do cliente · Agência" : "Área do Cliente"}
          </span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>

        {children}

        <footer className="client-footer">
          <span>iGrow Reports</span>
          <span>Ambiente seguro para acompanhamento de resultados</span>
        </footer>
      </div>
    </main>
  );
}
