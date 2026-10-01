import Link from "next/link";
import { ChartNoAxesCombined, LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { logoutAction } from "@/modules/auth/actions";

type ClientPortalShellProps = {
  children: ReactNode;
  title: string;
  description: string;
  userEmail: string | undefined;
  showClientSwitcher?: boolean;
};

export function ClientPortalShell({
  children,
  title,
  description,
  userEmail,
  showClientSwitcher = false,
}: ClientPortalShellProps) {
  return (
    <main className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/cliente" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white">
              <ChartNoAxesCombined size={20} />
            </span>
            <span>iGrow <span className="font-normal text-slate-500">Reports</span></span>
          </Link>
          <div className="flex items-center gap-3">
            {showClientSwitcher && (
              <Link href="/cliente" className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 sm:inline-flex">
                Trocar cliente
              </Link>
            )}
            <form action={logoutAction}>
              <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                <LogOut size={15} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            <ShieldCheck size={14} className="text-blue-600" />
            Área do Cliente
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
        </div>

        {children}

        <footer className="mt-12 flex flex-col gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>iGrow Digital · Inteligência para crescer</span>
          <span className="break-all">Conta: {userEmail ?? "autenticada"}</span>
        </footer>
      </div>
    </main>
  );
}
