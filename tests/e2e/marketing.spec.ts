import { expect, test } from "@playwright/test";

// Public presentation only: no sign-in, provider call, signup or customer mutation.
test("site comunica contexto e trabalho realizado, com metadados e recursos atuais", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Groow Ads — Inteligência a serviço do seu negócio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seu marketing precisa avançar.Você não precisa fazer tudo.");
  await expect(page.getByRole("link", { name: "Testar grátis por 7 dias", exact: true })).toHaveAttribute("href", "/criar-conta");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://groowads.com");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.getByText("Hoje: análises com IA e entregas agendadas. Execução de campanhas por IA em desenvolvimento.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Interface real da Groow Ads no computador/ })).toBeVisible();
});

test("galeria usa capturas reais, alterna por clique e teclado e amplia com foco contido", async ({ page }) => {
  await page.goto("/#plataforma");
  await page.getByRole("tab", { name: "WhatsApp", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("img")).toHaveAttribute("src", /whatsapp/);
  await page.getByRole("tab", { name: "WhatsApp", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Relatórios", exact: true })).toBeFocused();
  await expect(panel.getByRole("img")).toHaveAttribute("src", /reports/);
  await page.getByRole("tab", { name: "Relatórios", exact: true }).press("Home");
  await expect(panel.getByRole("img")).toHaveAttribute("src", /overview/);
  const zoom = page.getByRole("button", { name: /Ampliar tela/ });
  await zoom.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveAttribute("src", /overview/);
  await expect(dialog.getByRole("button", { name: "Fechar tela ampliada" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(zoom).toBeFocused();
});

test("planos preservam valores e explicitam a cobrança anual integral", async ({ page }) => {
  await page.goto("/#planos");
  await expect(page.locator("#planos")).toContainText("79,90");
  await page.getByRole("button", { name: "Anual Economize" }).click();
  for (const value of ["799,00", "1.499,00", "2.799,00"]) await expect(page.locator("#planos")).toContainText(value);
  await expect(page.getByText("Cobrança anual em pagamento integral.")).toHaveCount(3);
  await expect(page.locator("#planos")).toContainText("não incluída nesta oferta");
  await page.getByRole("button", { name: "Mensal", exact: true }).click();
  await expect(page.locator("#planos")).toContainText("149,90");
});

test("direção de execução fica separada das capacidades comercialmente disponíveis", async ({ page }) => {
  await page.goto("/#duvidas");
  const roadmap = page.getByRole("region", { name: /O próximo passo:/ });
  await expect(roadmap).toContainText("EM DESENVOLVIMENTO");
  await expect(roadmap).toContainText("ainda não estão disponíveis nos planos");
  const details = page.locator("details").filter({ hasText: "A IA já cria e otimiza campanhas sozinha?" });
  await details.locator("summary").click();
  await expect(details.locator("p")).toContainText("Ainda não.");
  const card = page.locator("details").filter({ hasText: "Preciso de cartão de crédito para começar?" });
  await card.locator("summary").click();
  await expect(card.locator("p")).toContainText("Não.");
});

test("vídeo só carrega após solicitação e reproduz a gravação com descrição e legendas", async ({ page }) => {
  const videoRequests: string[] = [];
  page.on("request", request => { if (/tour\.(mp4|webm)/.test(request.url())) videoRequests.push(request.url()); });
  await page.goto("/#demonstracao");
  await expect(page.locator("video")).toHaveCount(0);
  expect(videoRequests).toHaveLength(0);
  await page.getByRole("button", { name: "Reproduzir demonstração da plataforma" }).click();
  const video = page.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(1440);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  expect(videoRequests.length).toBeGreaterThan(0);
  await expect(video.locator("track")).toHaveAttribute("src", "/product/tour.vtt");
  await page.getByText("O que aparece no vídeo", { exact: false }).click();
  await expect(page.getByText("Não há narração.", { exact: false })).toBeVisible();
});

test("falha de carregamento do vídeo oferece descrição e nova tentativa", async ({ page }) => {
  await page.route(/tour\.(mp4|webm)/, route => route.abort());
  await page.goto("/#demonstracao");
  await page.getByRole("button", { name: "Reproduzir demonstração da plataforma" }).click();
  await expect(page.getByRole("status")).toContainText("Não foi possível carregar o vídeo");
  await expect(page.getByRole("button", { name: "Tentar reproduzir demonstração novamente" })).toBeVisible();
});

test("movimento decorativo pode ser pausado e respeita movimento reduzido", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Pausar animações decorativas" }).click();
  const resume = page.getByRole("button", { name: "Ativar animações decorativas" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  await resume.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const phone = page.getByRole("img", { name: /Versão móvel real/ });
  expect(await phone.evaluate(element => getComputedStyle(element.parentElement!).animationName)).toBe("none");
});

for (const width of [390, 768]) test(`telas, navegação e ampliação funcionam em ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/");
  if (width === 390) {
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("button", { name: "Fechar menu" })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("navigation", { name: "Navegação móvel", exact: true }).getByRole("link", { name: "Planos", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Navegação móvel", exact: true })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/#plataforma");
  await page.getByRole("button", { name: /Ampliar tela/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Fechar tela ampliada" }).click();
});
