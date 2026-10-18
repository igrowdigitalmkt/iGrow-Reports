import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), sales: vi.fn(), layout: vi.fn(), workspace: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/modules/marketing/sales-page", () => ({ SalesPage: mocks.sales }));
vi.mock("@/app/(workspace)/layout", () => ({ default: mocks.layout }));
vi.mock("@/modules/operations/workspace-page", () => ({ default: mocks.workspace }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: mocks.config, isDemoEnabled: () => false }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: mocks.session }));
vi.mock("@/modules/platform-admin/proxy-gate", () => ({ gateAdminRequest: vi.fn() }));
import HomePage, { generateMetadata } from "@/app/page";
import { proxy } from "@/proxy";

const searchParams = Promise.resolve({ periodo: "30d", client: "own-client" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue(null);
  mocks.config.mockReturnValue(null);
  mocks.session.mockResolvedValue(NextResponse.next());
});

describe("entrada pública e plataforma autenticada no mesmo endereço", () => {
  it("exibe o site público sem configuração, sem iniciar o carregamento do workspace", async () => {
    const result = await HomePage({ searchParams });
    expect(result.type).toBe(mocks.sales);
    expect(mocks.layout).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it.each([null, { id: "unverified-user" }])("não libera o workspace quando a autenticação falha: %j", async user => {
    mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: { message: "Invalid session" } }) } });
    expect((await HomePage({ searchParams })).type).toBe(mocks.sales);
  });
  it("mantém o layout protegido e os parâmetros da visão geral para uma sessão validada", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null }) } });
    const result = await HomePage({ searchParams }) as ReactElement<{ children: ReactElement<{ searchParams: typeof searchParams }> }>;
    expect(result.type).toBe(mocks.layout);
    expect(result.props.children.type).toBe(mocks.workspace);
    expect(result.props.children.props.searchParams).toBe(searchParams);
  });
  it("permite indexação apenas da apresentação pública", async () => {
    expect(await generateMetadata()).toMatchObject({ robots: { index: true }, alternates: { canonical: "https://groowads.com" } });
    mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null }) } });
    expect(await generateMetadata()).toMatchObject({ robots: { index: false, follow: false } });
  });
  it("não redireciona a página pública quando falta configuração", async () => {
    expect((await proxy(new NextRequest("http://localhost/"))).status).toBe(200);
    expect(mocks.session).toHaveBeenCalled();
  });
  it.each(["/whatsapp", "/clientes", "/relatorios", "/assinatura", "/admin"]) ("preserva a guarda da rota privada %s", async path => {
    const response = await proxy(new NextRequest(`http://localhost${path}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/entrar?estado=nao-configurado");
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("redireciona visitantes de rotas internas antes do streaming, mesmo com configuração publicada", async () => {
    mocks.config.mockReturnValue({ url: "https://db.example.test", publishableKey: "sb_publishable_test" });
    const response = await proxy(new NextRequest("http://localhost/whatsapp?conversa=example&canal=qr"));
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("next")).toBe("/whatsapp?conversa=example&canal=qr");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.session).not.toHaveBeenCalled();
    expect((await proxy(new NextRequest("http://localhost/"))).status).toBe(200);
  });
});
