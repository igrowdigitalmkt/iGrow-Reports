import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
// A temporary local-only harness exercises the actual component with intercepted API calls.
// It is removed before production builds; no real session is modified.
const base = "http://127.0.0.1:3158/demo/block-qa";
const directory = path.resolve("src/app/demo/block-qa");
const file = path.join(directory, "page.tsx");
await mkdir(directory, { recursive: true });
await writeFile(file, `"use client";
import { useState } from "react";
import { ContactBlockAction } from "@/modules/whatsapp/contact-block-action";
import "@/modules/whatsapp/contact-details.css";
export default function Page(){const [enabled,setEnabled]=useState(true);return <div className="wai-shell"><button onClick={()=>setEnabled(false)}>Somente leitura</button><div className="wai-details-section wai-details-actions"><ContactBlockAction conversationId="44444444-4444-4444-8444-444444444444" name="Contato ❤️" enabled={enabled}/></div></div>}
`, { flag: "wx" });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  for (const width of [1366,390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    let blocked = false, fail = false, queryFail = false, own = false;
    const changes = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/whatsapp/inbox/*/block", async route => {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON(); changes.push(payload);
        if (fail) return route.fulfill({ status: 502, json: { error: "WhatsApp não confirmou a alteração." } });
        blocked = payload.blocked;
      } else if (own) return route.fulfill({ json: { blocked: false, canBlock: false } });
      else if (queryFail) return route.fulfill({ status: 502, json: { error: "Estado indisponível." } });
      return route.fulfill({ json: { blocked } });
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: "Bloquear Contato ❤️", exact: true });
    await trigger.waitFor(); await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Bloquear contato", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Cancelar" }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await dialog.getByRole("button", { name: "Bloquear", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Escape"); assert.equal(await dialog.count(), 0); assert.deepEqual(changes, []);
    await trigger.click(); await dialog.getByRole("button", { name: "Bloquear", exact: true }).click();
    const unblock = page.getByRole("button", { name: "Desbloquear Contato ❤️", exact: true }); await unblock.waitFor();
    assert.deepEqual(changes, [{ blocked: true }]);
    await unblock.click(); await page.getByRole("dialog").getByRole("button", { name: "Desbloquear", exact: true }).click(); await trigger.waitFor();
    assert.deepEqual(changes, [{ blocked: true }, { blocked: false }]);
    fail = true; await trigger.click(); await dialog.getByRole("button", { name: "Bloquear", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "não confirmou" }).waitFor(); assert.equal(await dialog.count(),0);
    await page.getByRole("button", { name: "Somente leitura" }).click(); assert.equal(await trigger.isDisabled(),true);
    queryFail = true; await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("alert").filter({hasText:"Estado indisponível"}).waitFor(); assert.equal(await trigger.isDisabled(),true);
    queryFail = false; await page.getByRole("button",{name:"Atualizar estado"}).click();
    await page.waitForFunction(()=>!document.querySelector(".wai-contact-danger").disabled);
    blocked = true; await unblock.waitFor({ timeout: 20_000 });
    assert.equal(changes.length,3,"external block changes must not send a mutation");
    own = true; await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"Somente leitura"}).waitFor();
    await page.waitForFunction(()=>!document.querySelector(".wai-contact-danger"));
    assert.deepEqual(errors,[]);
    console.log(`PASS block ${width}: confirmation, keyboard, block/unblock, failure, permissions, recovery, external sync and own account`);
    await page.close();
  }
} finally {
  await browser?.close(); await unlink(file); await rmdir(directory);
}
