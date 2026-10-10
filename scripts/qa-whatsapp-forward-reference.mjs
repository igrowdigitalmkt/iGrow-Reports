/** Reference 02 QA. Uses only the isolated demo; never sends real messages.
 * ENABLE_DEMO=true pnpm exec next dev -p 3158
 * node scripts/qa-whatsapp-forward-reference.mjs
 */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname, "/demo/whatsapp", "QA must use the isolated demo");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.WA_QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
try {
  for (const [width, height, scale] of [
    [1920, 1080, 1], [1536, 864, 1], [1366, 768, 1], [1024, 768, 1],
    [390, 844, 1], [1536, 864, 1.25], [1280, 720, 1.5],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    const errors = [], sends = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.method() === "POST" && request.url().includes("/api/whatsapp/")) sends.push(request.url());
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".wai-row").filter({ hasText: "Paulo Henrique" }).first().click();
    const outgoing = page.locator(".wai-bubble-row.is-out").last();
    await outgoing.locator(".wai-bubble-stack").hover();
    await outgoing.getByRole("button", { name: "Mais opções da mensagem" }).click();
    await page.getByRole("dialog", { name: "Ações da mensagem" }).getByRole("button", { name: "Selecionar", exact: true }).click();
    await page.locator(".wai-bubble-row.is-in .wai-select-message-check input").first().check();
    const toolbar = page.getByRole("toolbar", { name: "Mensagens selecionadas" });
    const openDialog = async () => {
      await toolbar.getByRole("button", { name: "Encaminhar mensagens", exact: true }).click();
      await page.getByRole("dialog", { name: "Encaminhar mensagens para", exact: true }).waitFor();
    };
    await openDialog();
    const dialog = page.getByRole("dialog", { name: "Encaminhar mensagens para", exact: true });
    const search = dialog.getByRole("textbox", { name: "Buscar destinatário" });
    const confirm = dialog.getByRole("button", { name: "Encaminhar para as conversas selecionadas" });
    assert.ok(await search.evaluate(element => element === document.activeElement), "search receives focus");
    assert.equal(await confirm.count(), 0, "no confirm button before choosing a recipient");
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, "dialog fits viewport");
    if (width === 1920 && scale === 1) {
      assert.equal(bounds.width, 545);
      assert.equal(bounds.x, 688);
      assert.equal(bounds.y, 63);
      assert.equal((await search.locator("..").boundingBox()).height, 54);
      await page.screenshot({ path: "artifacts/whatsapp-02-after-1920.png" });
    }
    await search.fill("  Paulo  ");
    assert.equal(await dialog.getByRole("checkbox").count(), 1, "trimmed name search");
    const recipient = dialog.getByRole("checkbox", { name: "Encaminhar para Paulo Henrique" });
    await recipient.check();
    assert.ok(await confirm.isDisabled(), "demo cannot send even with recipients selected");
    await search.fill("not-a-contact-987");
    await dialog.getByRole("status").filter({ hasText: "Nenhuma conversa encontrada" }).waitFor();
    await search.fill("Mariana");
    assert.equal(await dialog.getByRole("checkbox").count(), 0, "other connected channels are excluded");
    await search.fill("558699999");
    assert.ok(await dialog.getByRole("checkbox").isChecked(), "phone search preserves recipient selection");
    await search.fill("RM Imobiliária");
    assert.equal(await dialog.getByRole("checkbox").count(), 1, "client search");
    await search.fill("");
    const close = dialog.getByRole("button", { name: "Fechar encaminhamento" });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    assert.ok(await dialog.getByRole("checkbox").last().evaluate(element => element === document.activeElement), "backward tab stays inside dialog");
    await page.keyboard.press("Tab");
    assert.ok(await close.evaluate(element => element === document.activeElement), "forward tab wraps to close");
    await search.focus();
    if (width === 390) await page.screenshot({ path: "artifacts/whatsapp-02-after-390.png" });
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0, "escape closes dialog");
    await openDialog();
    assert.equal(await search.inputValue(), "", "reopening resets search");
    assert.equal(await dialog.getByRole("checkbox").evaluateAll(elements => elements.filter(element => element.checked).length), 0, "reopening resets recipients");
    await close.click();
    assert.equal(await dialog.count(), 0, "close button works");
    assert.deepEqual(errors, [], "no browser errors");
    assert.deepEqual(sends, [], "no WhatsApp mutations during demo QA");
    console.log(`PASS ${width}×${height} @${scale}: geometry, search, channel isolation, selection, keyboard, no sending`);
    await page.close();
  }
} finally {
  await browser.close();
}
