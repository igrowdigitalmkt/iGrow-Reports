import { test, expect } from "@playwright/test";

/** 29 reference screenshots are from WhatsApp Web dark mode (1649×928).
 * Tests measure the iGrow WhatsApp region, not the host dashboard toolbar.
 * No real WhatsApp number or messages are touched.
 */
test("reference layout dimensions across desktop and mobile", async ({ browser }) => {
  for (const [width, height, rail, head, search] of [
    [1536, 864, 70, 69, 42],
    [1024, 768, 62, 69, 42],
    [390, 844, 55, 65, 42],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto("/demo/whatsapp");
    await expect(page.locator(".wai-row").first()).toBeVisible();
    const dimensions = await page.locator(".wai-shell").evaluate(el => {
      const box = (s: string) => el.querySelector(s)?.getBoundingClientRect();
      return {
        rail: box(".wai-rail")?.width,
        head: box(".wai-list-head")?.height,
        search: box(".wai-search")?.height,
        listColor: getComputedStyle(el.querySelector(".wai-list")!).backgroundColor,
        docWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });
    expect(dimensions.rail).toBe(rail);
    expect(dimensions.head).toBe(head);
    expect(dimensions.search).toBe(search);
    expect(dimensions.listColor).toBe("rgb(22, 23, 23)");
    expect(dimensions.docWidth).toBeLessThanOrEqual(dimensions.viewport);
    await page.locator(".wai-row").first().click();
    await expect(page.locator(".wai-chat-head")).toBeVisible();
    await expect(page.locator(".wai-composer-area")).toBeVisible();
    await page.close();
  }
});

test("contact details and message search resize the chat instead of covering it", async ({ page }) => {
  await page.goto("/demo/whatsapp");
  await page.locator(".wai-row").first().click();
  await page.locator(".wai-contact-trigger").click();
  await expect(page.getByRole("complementary", { name: "Dados do contato" })).toBeVisible();
  const panel = await page.locator(".wai-details").boundingBox();
  const chat = await page.locator(".wai-messages").boundingBox();
  expect(panel && chat).toBeTruthy();
  expect(chat!.x + chat!.width).toBeLessThanOrEqual(panel!.x + 2);
  await page.getByRole("button", { name: "Pesquisar nesta conversa" }).click();
  await expect(page.getByRole("complementary", { name: "Pesquisar mensagens" })).toBeVisible();
  await page.getByRole("textbox", { name: "Pesquisar nesta conversa" }).fill("Bom");
  await expect(page.locator(".wai-chat-search-results button").first()).toBeVisible();
});

test("phone dialer can start a draft, and bulk selection only exposes supported actions", async ({ page }) => {
  await page.goto("/demo/whatsapp");
  await page.getByRole("button", { name: "Nova conversa" }).click();
  await page.getByRole("button", { name: "Abrir teclado numérico" }).click();
  await expect(page.getByRole("textbox", { name: "Telefone" })).toBeVisible();
  await page.getByRole("textbox", { name: "Telefone" }).fill("869995560428");
  await expect(page.getByRole("button", { name: "Iniciar conversa" })).toBeEnabled();
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("button", { name: "Opções de conversas" }).click();
  await page.getByRole("menuitem", { name: "Selecionar conversas" }).click();
  await expect(page.getByText("Selecionadas: 0")).toBeVisible();
  await page.locator(".wai-select-row input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "Ações das conversas selecionadas" }).click();
  await expect(page.getByRole("menuitem", { name: "Arquivar conversas" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Apagar|Limpar/ })).toHaveCount(0);
});
