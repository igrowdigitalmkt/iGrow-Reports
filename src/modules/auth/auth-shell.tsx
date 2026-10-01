import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#0b0f17] px-5 py-10 text-slate-100 sm:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="relative grid w-full max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <section className="flex flex-col justify-center">
          <Link href="/" aria-label="iGrow Reports, início" className="mb-12 inline-flex w-fit items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-blue-500/20"><ChartNoAxesCombined size={23} /></span>
            <span>iGrow<span className="ml-2 text-base font-normal text-slate-400">Reports</span></span>
          </Link>
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1.5 text-xs font-medium text-cyan-300"><Sparkles size={13} /> Clareza para cada resultado</div>
          <h1 className="max-w-lg text-4xl leading-[1.15] font-semibold tracking-tight sm:text-5xl">Os números contam.<br /><span className="text-blue-400">A sua análise transforma.</span></h1>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-400">Um espaço para acompanhar a operação e transformar performance em conversas melhores com seus clientes.</p>
          <div className="mt-10 flex items-start gap-3 text-sm text-slate-400"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-400" size={18} /><p>Acesso protegido por conta.<br /><span className="text-slate-500">Cada pessoa visualiza somente os ambientes autorizados.</span></p></div>
        </section>
        <section className="self-center rounded-3xl border border-white/10 bg-[#111723] p-6 shadow-2xl shadow-black/20 sm:p-9">{children}</section>
        <p className="text-xs text-slate-500 lg:col-span-2">iGrow Digital <span aria-hidden="true">·</span> Inteligência para crescer <ArrowUpRight className="ml-1 inline" size={12} /></p>
      </div>
    </main>
  );
}

