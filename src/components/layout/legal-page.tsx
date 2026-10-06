import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";

export const LEGAL_CONTACT_EMAIL = "igrowdigitalmkt@gmail.com";
export const LEGAL_UPDATED_AT = "6 de outubro de 2026";

// Public legal pages (privacy, data deletion): readable text column, no login required.
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="legal-page">
    <header className="legal-header">
      <Link href="/" className="brand-link" aria-label="iGrow Reports"><Brand /></Link>
      <nav aria-label="Páginas legais"><Link href="/privacidade">Privacidade</Link><Link href="/exclusao-de-dados">Exclusão de dados</Link></nav>
    </header>
    <main className="legal-content">
      <h1>{title}</h1>
      <p className="legal-updated">Última atualização: {LEGAL_UPDATED_AT}</p>
      {children}
    </main>
    <footer className="legal-footer">iGrow Reports · iGrow Digital · <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></footer>
  </div>;
}
