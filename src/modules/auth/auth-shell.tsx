import Image from "next/image";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

// Moldura das telas de acesso (entrar, criar conta, recuperar senha, convite, espaço de trabalho),
// com a mesma identidade do site comercial. Apenas visual: os formulários e ações não mudam.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div aria-hidden="true" className="auth-glow" />
      <div className="auth-layout">
        <header className="auth-brand">
          <Link href="/" aria-label="Groow Ads, início"><Image src="/brand/groow-ads-color.png" alt="Groow Ads" width={1920} height={350} priority className="auth-logo" /></Link>
        </header>

        <section className="auth-story">
          <span className="auth-kicker">Inteligência de marketing para anúncios</span>
          <h1 className="auth-headline">Você define onde chegar. <em>A Groow Ads faz o trabalho.</em></h1>
          <p className="auth-lead">Entre para acompanhar seus clientes, suas campanhas e tudo o que a Groow fez por você.</p>
          <div className="auth-visual" aria-hidden="true">
            <div className="auth-screen"><Image src="/product/overview.webp" alt="" width={1440} height={1000} sizes="(max-width: 1024px) 0px, 560px" /></div>
            <div className="auth-phone"><Image src="/product/mobile.webp" alt="" width={390} height={844} sizes="(max-width: 1024px) 0px, 130px" /></div>
          </div>
          <p className="auth-trust"><ShieldCheck size={18} /> Acesso protegido. Cada pessoa vê somente os espaços autorizados para a sua conta.</p>
        </section>

        <section className="auth-card">{children}</section>

        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} Groow Ads · Uma plataforma da iGrow Digital</span>
          <span><Link href="/privacidade">Privacidade</Link><Link href="/">Conheça a Groow Ads</Link></span>
        </footer>
      </div>
    </main>
  );
}
