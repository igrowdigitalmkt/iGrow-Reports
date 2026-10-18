import { expect, test } from "@playwright/test";

test("endereços diretos mantêm a proteção da área interna", async ({ request }) => {
  for (const path of ["/", "/whatsapp", "/clientes", "/clientes/cliente-teste", "/relatorios", "/relatorios/entregas", "/relatorios/templates", "/relatorios/pdfs", "/agendamentos", "/integracoes", "/equipe", "/configuracoes", "/assinatura", "/assinatura/retorno?e=ok"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    const target = new URL(response.headers().location, "http://127.0.0.1:3100");
    expect(target.pathname, path).toBe("/entrar");
    expect(target.searchParams.get("estado"), path).toBe("nao-configurado");
  }
});

test("endereços antigos redirecionam permanentemente preservando caminhos e parâmetros", async ({ request }) => {
  for (const [oldPath, newPath] of [["/dashboard", "/"], ["/dashboard/whatsapp", "/whatsapp"], ["/dashboard/clientes/cliente-teste", "/clientes/cliente-teste"], ["/dashboard/relatorios/pdfs", "/relatorios/pdfs"], ["/dashboard/assinatura/retorno", "/assinatura/retorno"]]) {
    const response = await request.get(`${oldPath}?e=ok&conta=um&conta=dois&nome=Ol%C3%A1`, { maxRedirects: 0 });
    expect(response.status(), oldPath).toBe(308);
    const target = new URL(response.headers().location, "http://127.0.0.1:3100");
    expect(target.pathname, oldPath).toBe(newPath);
    expect(target.searchParams.get("e")).toBe("ok");
    expect(target.searchParams.getAll("conta")).toEqual(["um", "dois"]);
    expect(target.searchParams.get("nome")).toBe("Olá");
  }
});

test("o navegador segue o endereço antigo do WhatsApp até o login", async ({ page }) => {
  await page.goto("/dashboard/whatsapp");
  await expect(page).toHaveURL(/\/entrar\?estado=nao-configurado$/);
  await expect(page.getByRole("button", { name: "Entrar na plataforma", exact: true })).toBeDisabled();
});

test("o menu da demonstração continua navegando para o WhatsApp", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: /^WhatsApp/ }).click();
  await expect(page).toHaveURL(/\/demo\/whatsapp$/);
  await expect(page.locator(".main-content")).toHaveClass(/is-full/);
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("aria-current", "page");
});

test("endereços inexistentes continuam retornando 404", async ({ request }) => {
  const response = await request.get("/pagina-inexistente", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});
