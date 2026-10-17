import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ server: vi.fn(), signUp: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/modules/agencies/context", () => ({ AGENCY_COOKIE: "agency", requireUserSession: vi.fn() }));
vi.mock("@/modules/client-portal/invitations", () => ({ acceptPendingClientInvitations: vi.fn() }));
vi.mock("@/modules/agencies/invitations", () => ({ acceptPendingAgencyInvitations: vi.fn() }));
vi.mock("@/modules/auth/password-state", () => ({ markPasswordSet: vi.fn(), needsPasswordSetup: vi.fn() }));
import { signUpAction } from "@/modules/auth/actions";

const existingAccountError = "Este e-mail já está cadastrado. Entre na sua conta ou recupere a senha.";
const newUser = { id: "new-user", identities: [{ provider: "email" }] };
function registration() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "Pessoa Teste", agency: "Empresa Teste", email: "pessoa@example.com", password: "senha-ficticia-para-teste" })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://groow.example");
  mocks.server.mockResolvedValue({ auth: { signUp: mocks.signUp } });
  mocks.signUp.mockResolvedValue({ data: { user: newUser, session: null }, error: null });
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});
afterEach(() => vi.unstubAllEnvs());

it("mantém uma conta existente no formulário sem afirmar envio de confirmação", async () => {
  mocks.signUp.mockResolvedValue({ data: { user: { id: "obfuscated", identities: [] }, session: null }, error: null });
  expect(await signUpAction({ error: null }, registration())).toEqual({ error: existingAccountError, sent: null });
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it.each(["user_already_exists", "email_exists"])("orienta o acesso quando Supabase retorna %s", async code => {
  mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code, status: 422 } });
  expect(await signUpAction({ error: null }, registration())).toEqual({ error: existingAccountError, sent: null });
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("preserva a confirmação de uma conta nova e o destino de criação do espaço", async () => {
  expect(await signUpAction({ error: null }, registration())).toEqual({ error: null, sent: "pessoa@example.com" });
  expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
    options: {
      data: { full_name: "Pessoa Teste", pending_agency_name: "Empresa Teste" },
      emailRedirectTo: "https://groow.example/auth/callback?next=/criar-espaco",
    },
  }));
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("não confirma envio quando o provedor não retorna um usuário", async () => {
  mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
  const result = await signUpAction({ error: null }, registration());
  expect(result.error).toBeTruthy();
  expect(result.sent).toBeNull();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("preserva o redirecionamento de uma conta nova quando o provedor retorna sessão", async () => {
  mocks.signUp.mockResolvedValue({ data: { user: newUser, session: { user: newUser } }, error: null });
  await expect(signUpAction({ error: null }, registration())).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/criar-espaco");
});

it.each([
  [{ status: 429 }, "Muitos cadastros seguidos. Aguarde alguns minutos e tente de novo."],
  [{ code: "weak_password", status: 422 }, "Escolha uma senha mais forte."],
])("preserva os erros do provedor sem avançar", async (error, message) => {
  mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error });
  expect(await signUpAction({ error: null }, registration())).toEqual({ error: message });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
