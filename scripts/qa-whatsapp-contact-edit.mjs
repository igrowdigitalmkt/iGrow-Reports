import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
const directory = path.resolve("src/app/demo/contact-edit-qa");
const file = path.join(directory, "page.tsx");
await mkdir(directory, { recursive: true });
await mkdir("artifacts", { recursive: true });
await writeFile(file, `"use client";
import {useState} from "react";
import {ContactEditAction} from "@/modules/whatsapp/contact-edit-action";
import "@/modules/whatsapp/contact-details.css";
export default function Page(){const [name,setName]=useState("Antigo ❤️");const [enabled,setEnabled]=useState(true);return <div className="wai-shell" ref={element=>{element?.setAttribute("data-ready","true")}}><p role="status">{name}</p><button onClick={()=>setEnabled(false)}>Somente leitura</button><ContactEditAction conversationId="44444444-4444-4444-8444-444444444444" enabled={enabled} demo={false} onSaved={setName}/></div>;}
`, { flag: "wx" });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  for (const width of [1366,390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const changes = [], errors = [];
    let nativeName = "Antigo ❤️", fail = false, queryFail = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/whatsapp/inbox/*/contact", async route => {
      if (route.request().method() === "PATCH") {
        const payload = route.request().postDataJSON(); changes.push(payload);
        if (fail) return route.fulfill({ status:409, json:{error:"O nome mudou no WhatsApp. Reabra a edição."} });
        nativeName = payload.fullName;
      } else if (queryFail) return route.fulfill({status:409,json:{error:"Contato não salvo no WhatsApp."}});
      return route.fulfill({json:{fullName:nativeName,firstName:nativeName.split(" ")[0],canEdit:true}});
    });
    await page.goto("http://127.0.0.1:3158/demo/contact-edit-qa",{waitUntil:"domcontentloaded"});
    await page.locator('[data-ready="true"]').waitFor();
    const trigger=page.getByRole("button",{name:"Editar contato",exact:true}); await trigger.click();
    const dialog=page.getByRole("dialog",{name:"Editar contato",exact:true});
    const fullName=dialog.getByRole("textbox",{name:"Nome completo",exact:true});
    const value=locator=>locator.evaluate(element=>[...element.childNodes].map(node=>node.nodeName==="IMG"?node.alt:node.textContent).join(""));
    await fullName.waitFor(); assert.equal(await value(fullName),"Antigo ❤️");
    assert.equal(await fullName.locator("img.wai-original-emoji").count(),1);
    await page.waitForFunction(()=>document.activeElement?.getAttribute("role")==="textbox");
    await fullName.fill("Cancelado"); await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();
    assert.deepEqual(changes,[]); assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
    await trigger.click(); await fullName.waitFor(); await fullName.fill("Novo ❤️");
    await dialog.getByRole("textbox",{name:"Primeiro nome",exact:true}).fill("Novo");
    assert.equal(await fullName.getAttribute("aria-multiline"),"false");
    assert.equal(await fullName.locator("img").evaluate(image=>getComputedStyle(image).display),"inline-block");
    await page.screenshot({path:`artifacts/whatsapp-contact-edit-${width}.png`});
    await page.keyboard.press("Shift+Tab"); assert.equal(await fullName.evaluate(element=>element===document.activeElement),true);
    await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Novo ❤️"}).waitFor();
    assert.deepEqual(changes,[{fullName:"Novo ❤️",firstName:"Novo",expectedFullName:"Antigo ❤️"}]);
    assert.equal(await dialog.count(),0);
    nativeName="Externo ❤️"; await trigger.click(); await fullName.waitFor(); assert.equal(await value(fullName),nativeName);
    await page.keyboard.press("Escape"); assert.equal(await dialog.count(),0);
    fail=true; await trigger.click(); await fullName.waitFor(); await fullName.fill("Falha");
    await dialog.getByRole("button",{name:"Salvar",exact:true}).click();
    await dialog.getByRole("alert").waitFor(); assert.equal(await dialog.getByRole("button",{name:"Salvar",exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole("status").textContent(),"Novo ❤️");
    await dialog.getByRole("button",{name:"Cancelar",exact:true}).click();
    queryFail=true; await trigger.click(); await dialog.getByRole("alert").waitFor();
    assert.equal(await fullName.count(),0); await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Somente leitura",exact:true}).click(); assert.equal(await trigger.isDisabled(),true);
    assert.deepEqual(errors,[]); console.log(`PASS contact edit ${width}: native load, save, cancel, conflict, external name, permissions, keyboard and failure`);
    await page.close();
  }
} finally { await browser?.close(); await unlink(file); await rmdir(directory); }
