import Link from "next/link";
import { Brand } from "@/components/layout/brand";

export default function NotFound() {
  return <main className="standalone"><Brand /><div className="panel max-w-lg p-9"><span className="eyebrow">404 · PÁGINA NÃO ENCONTRADA</span><h1 className="mt-4 text-3xl font-semibold">Vamos voltar ao painel?</h1><p className="muted mt-3 mb-7">Este endereço não existe ou não está disponível neste ambiente.</p><Link className="button button-primary" href="/dashboard">Ir para o dashboard</Link></div></main>;
}

