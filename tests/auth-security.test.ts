import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, isDemoEnabled } from "@/lib/env";
import { isAuthCookie } from "@/lib/supabase/constants";
import { safeRedirect } from "@/modules/auth/redirect";
import { invitationTokenSchema, passwordSchema } from "@/modules/auth/schemas";

afterEach(() => vi.unstubAllEnvs());

describe("destinos após autenticação", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/dashboard%0d%0aLocation:https://evil.example", "/dashboard//evil.example", "/dashboard/%2f%2fevil.example", "/entrar", "javascript:alert(1)", "/%", "/%E0%A4%A", undefined])("rejeita destino externo ou inválido %s", (value) => {
    expect(safeRedirect(value)).toBe("/");
  });

  it.each(["/", "/clientes", "/clientes/11111111-0000-4000-8000-000000000001", "/agendamentos", "/relatorios", "/relatorios/pdfs", "/integracoes", "/equipe", "/configuracoes", "/whatsapp", "/assinatura", "/assinatura/retorno?e=ok"])("permite a rota autenticada direta %s", (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each(["/whatsappexterno", "/clientes-outro", "/relatoriosprivados", "/dashboard-outro", "/api/whatsapp/inbox", "/privacidade", "/demo", "/desconhecido"])("não amplia a permissão para %s", (path) => {
    expect(safeRedirect(path)).toBe("/");
  });

  it.each([
    ["/dashboard?periodo=7d", "/?periodo=7d"],
    ["/dashboard/whatsapp?conversa=abc&canal=qr", "/whatsapp?conversa=abc&canal=qr"],
    ["/dashboard/clientes/abc?conta=a&conta=b", "/clientes/abc?conta=a&conta=b"],
    ["/dashboard/assinatura/retorno?e=cancelado", "/assinatura/retorno?e=cancelado"],
  ])("normaliza o destino antigo %s sem perder parâmetros", (legacy, current) => {
    expect(safeRedirect(legacy)).toBe(current);
  });

  it("preserva convite interno após login", () => {
    const path = `/convite?token=${"a".repeat(64)}`;
    expect(safeRedirect(path)).toBe(path);
    expect(safeRedirect("/selecionar-espaco")).toBe("/selecionar-espaco");
    expect(safeRedirect("/selecionar-agencia")).toBe("/selecionar-agencia");
    expect(safeRedirect("/cliente")).toBe("/cliente");
    expect(safeRedirect("/cliente/11111111-0000-4000-8000-000000000001")).toBe("/cliente/11111111-0000-4000-8000-000000000001");
  });
});

describe("configuração sem bypass", () => {
  it("reconhece configuração ausente", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(getSupabaseConfig()).toBeNull();
  });

  it("rejeita chaves privilegiadas e aceita somente a chave pública", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_not_a_public_key");
    expect(getSupabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `eyJ.${btoa(JSON.stringify({ role: "service_role" }))}.signature`);
    expect(getSupabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    expect(getSupabaseConfig()?.url).toBe("https://example.supabase.co");
  });

  it("desativa demonstração em produção por padrão", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEMO", undefined);
    expect(isDemoEnabled()).toBe(false);
  });

  it("respeita desativação explícita no desenvolvimento", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEMO", "false");
    expect(isDemoEnabled()).toBe(false);
  });
});

describe("credenciais e encerramento de sessão", () => {
  it("identifica todas as partes dos cookies próprios sem remover cookies de outros aplicativos", () => {
    for (const name of ["igrow-auth", "igrow-auth.0", "igrow-auth.3", "igrow-auth-code-verifier", "igrow-auth-code-verifier.0"]) expect(isAuthCookie(name)).toBe(true);
    for (const name of ["other-auth", "igrow-auth-other", "igrow-authentic", "preferences"]) expect(isAuthCookie(name)).toBe(false);
  });

  it("exige o token completo e senhas confirmadas", () => {
    expect(invitationTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(invitationTokenSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "curta12", confirmation: "curta12" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "senha123", confirmation: "senha123" }).success).toBe(true);
    expect(passwordSchema.safeParse({ password: "uma-frase-de-senha", confirmation: "outra-senha-diferente" }).success).toBe(false);
  });
});

