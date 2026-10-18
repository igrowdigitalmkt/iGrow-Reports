import { expect, test } from "@playwright/test";

test("visitante recebe o site de vendas com cadastro, planos e metadados públicos", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Groow Ads — Sua operação de marketing, conectada");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Menos rotina.Mais crescimento.");
  await expect(page.getByRole("link", { name: "Testar grátis por 7 dias", exact: true }).first()).toHaveAttribute("href", "/criar-conta");
  await expect(page.getByRole("navigation", { name: "Navegação do site", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://groowads.com");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.getByText("Prévia ilustrativa da plataforma. Dados e conversas demonstrativos.")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("groow-sales-desktop.png"), animations: "disabled" });
  await page.screenshot({ path: test.info().outputPath("groow-sales-full.png"), fullPage: true, animations: "disabled" });
});

test("prévia alterna recursos por clique e teclado sem acessar dados reais", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Obrigada pelo relatório!");
  await page.getByRole("tab", { name: "WhatsApp", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Relatórios", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Relatórios e entregas");
  await page.getByRole("tab", { name: "Relatórios", exact: true }).press("Home");
  await expect(page.getByRole("tabpanel")).toContainText("Custo por resultado");
});

test("planos exibem mensal e anual com cobrança integral explícita", async ({ page }) => {
  await page.goto("/#planos");
  await expect(page.locator("#planos")).toContainText("79,90");
  await page.getByRole("button", { name: "Anual Economize" }).click();
  await expect(page.locator("#planos")).toContainText("799,00");
  await expect(page.locator("#planos")).toContainText("1.499,00");
  await expect(page.locator("#planos")).toContainText("2.799,00");
  await expect(page.getByText("Cobrança anual em pagamento integral.")).toHaveCount(3);
  await page.getByRole("button", { name: "Mensal", exact: true }).click();
  await expect(page.locator("#planos")).toContainText("149,90");
});

test("perguntas expandem sem formulário, rastreamento ou envio de dados", async ({ page }) => {
  await page.goto("/#duvidas");
  const details = page.locator("details").filter({ hasText: "Preciso de cartão de crédito para começar?" });
  await details.locator("summary").click();
  await expect(details.locator("p")).toBeVisible();
  await expect(details.locator("p")).toContainText("Não. Crie sua conta");
});

test("menu e conteúdo funcionam no celular sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("button", { name: "Fechar menu" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).getByRole("link", { name: "Planos", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navegação móvel", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#planos$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("#planos").getByText("Start", { exact: true })).toBeVisible();
  await page.goto("/");
  await page.screenshot({ path: test.info().outputPath("groow-sales-mobile.png"), animations: "disabled" });
});
