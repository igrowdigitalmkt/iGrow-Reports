import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "@/components/layout/brand";
import { logoutAction } from "@/modules/auth/actions";
import "./portal-shell.css";

type ClientPortalShellProps = {
  children: ReactNode;
  title: string;
  description: string;
  userEmail: string | undefined;
  showClientSwitcher?: boolean;
  agencyMode?: boolean;
  /** The page renders its own heading (the analytics dashboard does). */
  hideHeading?: boolean;
};

export function ClientPortalShell({
  children,
  title,
  description,
  userEmail,
  showClientSwitcher = false,
  agencyMode = false,
  hideHeading = false,
}: ClientPortalShellProps) {
  return (
    <main className="client-portal">
      <header className="client-topbar">
        <div className="client-topbar-inner">
          <Link href={agencyMode ? "/dashboard/clientes" : "/cliente"} aria-label="iGrow Reports, Área do Cliente" className="client-brand-link">
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
        {!hideHeading && <div className="client-page-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>}

        {children}

        <footer className="client-footer">
          <span>iGrow Reports</span>
          <span>Acesso protegido aos resultados do seu negócio</span>
        </footer>
      </div>
    </main>
  );
}
