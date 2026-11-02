import type { Metadata } from "next";
import { Brand } from "@/components/layout/brand";
import "@/modules/lead-pages/lead-feed.css";

export const metadata: Metadata = { title: "Cadastros · RM Imobiliária", robots: { index: false, follow: false } };

// Endereço público da página: sem o código do link privado ele não mostra nenhum dado.
export default function Page() {
  return <main className="lead-notice"><div>
    <Brand />
    <h1>Acompanhamento de cadastros</h1>
    <p>Esta página é privada. Para ver os cadastros em tempo real, abra o link de acesso enviado pela equipe da iGrow Digital.</p>
  </div></main>;
}
