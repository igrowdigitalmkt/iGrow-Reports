import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname, "/demo/whatsapp");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
try {
  for (const [width, height] of [[1920,1080],[1366,768],[1024,768],[390,844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [], mutations = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (["POST","PATCH","DELETE"].includes(request.method()) && request.url().includes("/api/whatsapp/")) mutations.push(request.url()); });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator(".wai-row").filter({ hasText: "Diretoria Colégio" }).click();
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    const read = () => input.evaluate(element => {
      const text = node => node.nodeType === Node.TEXT_NODE ? node.textContent : node instanceof HTMLImageElement ? node.alt : node instanceof HTMLBRElement ? node.dataset.editorTail ? "" : "\n" : Array.from(node.childNodes, text).join("");
      return text(element);
    });
    if (width === 1920) {
      await input.fill("AB"); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
      await page.getByTitle("Emojis", { exact: true }).click();
      const picker = page.getByRole("dialog", { name: "Emojis", exact: true });
      await picker.getByRole("tab", { name: "Smileys e pessoas" }).click();
      await picker.locator('button:has(img[alt="😀"])').click();
      assert.equal(await read(), "A😀B");
      await page.keyboard.insertText("Z"); assert.equal(await read(), "A😀ZB");
      await page.getByTitle("Emojis", { exact: true }).click();
      await input.fill("teste");
      const count = await page.locator(".wai-bubble-row").count();
      await input.evaluate(element => {
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        element.append(document.createTextNode("あ"));
        const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        element.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "あ" }));
        element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", isComposing: true }));
        element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "あ" }));
      });
      assert.equal(await read(), "testeあ"); assert.equal(await page.locator(".wai-bubble-row").count(), count);
      await input.fill("a".repeat(4095));
      await input.evaluate(element => { const data = new DataTransfer(); data.setData("text/plain", "👍🏽"); element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })); });
      assert.equal(await read(), "a".repeat(4095));
    }
    await input.fill("Olá ❤️ 😂");
    assert.equal(await input.locator("img").count(), 2);
    await input.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await input.locator("img").first().evaluate(image => image.naturalWidth), 64);
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    assert.equal(await read(), "Olá ❤️ ");
    await page.keyboard.press("Control+z"); assert.equal(await read(), "Olá ❤️ 😂");
    await page.keyboard.press("Control+Shift+z"); assert.equal(await read(), "Olá ❤️ ");
    await page.keyboard.insertText("👍🏽");
    await page.keyboard.press("Backspace"); assert.equal(await read(), "Olá ❤️ ");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("segunda linha");
    assert.equal(await read(), "Olá ❤️ \nsegunda linha");
    // Rich HTML from the clipboard is ignored; only Unicode text enters the editor.
    await input.evaluate(element => {
      const data = new DataTransfer(); data.setData("text/plain", " 🇧🇷"); data.setData("text/html", '<b>unexpected</b><img src="https://example.test/tracker">');
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    });
    assert.equal(await read(), "Olá ❤️ \nsegunda linha 🇧🇷");
    assert.equal(await input.locator("b").count(), 0);
    await page.keyboard.press("Control+a");
    const copied = await input.evaluate(element => {
      const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data })); return data.getData("text/plain");
    });
    assert.equal(copied, "Olá ❤️ \nsegunda linha 🇧🇷");
    await page.keyboard.insertText("substituído 😂");
    assert.equal(await read(), "substituído 😂");
    await input.fill("Olá ❤️ 😂");
    if (width === 1920 || width === 390) await page.screenshot({ path: `artifacts/whatsapp-emoji-input-${width}.png` });
    const before = await page.locator(".wai-bubble-row").count();
    await page.keyboard.press("Enter");
    await page.waitForFunction(count => document.querySelectorAll(".wai-bubble-row").length > count, before);
    assert.equal(await read(), "");
    const outgoing = page.locator(".wai-bubble-row.is-out").last();
    assert.deepEqual(await outgoing.locator(".wai-text img").evaluateAll(images => images.map(image => image.alt)), ["❤️", "😂"]);
    assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
    console.log(`PASS emoji editor ${width}: original PNGs, Unicode editing, deletion, history, newline, paste, copy and send`);
    await page.close();
  }
} finally { await browser.close(); }
