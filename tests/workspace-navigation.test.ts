import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));

import { AppShell } from "@/components/layout/app-shell";

const identity = { agencyName: "Espaço de teste", userName: "Pessoa", roleLabel: "Proprietário", timezone: "America/Sao_Paulo" };
const render = (pathname: string, demo = false) => {
  route.pathname = pathname;
  const props = { demo, identity, children: "Conteúdo" };
  return renderToStaticMarkup(createElement(AppShell, props));
};

describe("navegação do espaço sem prefixo", () => {
  it("liga a marca e a visão geral à raiz e as seções aos endereços diretos", () => {
    const html = render("/");
    for (const href of ["/", "/clientes", "/relatorios", "/agendamentos", "/integracoes", "/equipe", "/configuracoes", "/whatsapp"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).not.toContain('href=""');
    expect(html).not.toContain('href="//');
    expect(html).not.toContain("/dashboard");
    expect(html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0]).toContain('href="/"');
  });

  it("destaca WhatsApp e mantém a tela de conversa ocupando a área inteira", () => {
    const html = render("/whatsapp");
    expect(html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0]).toContain('href="/whatsapp"');
    expect(html).toContain('class="main-content is-full"');
    expect(html).toContain("<strong>WhatsApp</strong>");
  });

  it("mantém os caminhos e a seleção da demonstração", () => {
    const html = render("/demo/whatsapp", true);
    expect(html).toContain('href="/demo"');
    expect(html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0]).toContain('href="/demo/whatsapp"');
    expect(html).toContain('href="/demo/clientes"');
  });

  it("mantém o caminho do cliente e o nome da aba de relatórios", () => {
    expect(render("/clientes/cliente-teste")).toContain("Painel do cliente");
    const html = render("/relatorios/pdfs");
    expect(html).toContain('href="/relatorios"');
    expect(html).toContain("<strong>PDFs salvos</strong>");
  });
});
