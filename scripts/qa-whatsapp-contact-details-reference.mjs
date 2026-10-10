import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const base = process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname, "/demo/whatsapp");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
try {
  for (const [width,height,scale] of [[1920,1080,1],[1366,768,1],[1024,768,1],[390,844,1],[1536,864,1.25],[1280,720,1.5]]) {
    const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:scale});
    const errors=[],mutations=[];
    page.on("pageerror", error=>errors.push(error.message));
    page.on("console", message=>{if(message.type()==="error" && !message.text().startsWith("Failed to load resource"))errors.push(message.text());});
    page.on("request", request=>{if(["POST","PATCH","DELETE"].includes(request.method()) && request.url().includes("/api/whatsapp/"))mutations.push(request.url());});
    await page.goto(base,{waitUntil:"domcontentloaded"});
    await page.locator(".wai-row").filter({hasText:"Lindaiane"}).click();
    const contactName=await page.locator(".wai-chat-title strong").textContent();
    await page.getByTitle("Dados do contato",{exact:true}).click();
    const panel=page.getByRole("complementary",{name:"Dados do contato",exact:true});
    await panel.waitFor();
    const box=await panel.boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=width+1);
    if(width===1920)assert.equal(Math.round(box.width),575);
    if(width>760){const chat=await page.locator(".wai-chat-head").boundingBox();assert.ok(chat.x+chat.width<=box.x+1,"panel must not overlap the chat header");}
    assert.equal(await panel.getByRole("button",{name:"Adicionar aos Favoritos",exact:true}).isDisabled(),true);
    assert.ok((await panel.textContent()).includes("1 grupo em comum"));
    const commonGroup = panel.getByRole("button",{name:/Abrir grupo/});
    assert.equal(await commonGroup.count(),1);
    assert.ok((await commonGroup.textContent()).includes(`${contactName}, Você`));
    const lists=panel.getByRole("button",{name:"Mudar lista",exact:true}); await lists.click();
    assert.equal(await lists.getAttribute("aria-expanded"),"true");
    assert.equal(await panel.getByRole("checkbox").count(),4);
    assert.ok(await panel.getByRole("checkbox").first().isDisabled());
    await lists.click(); await lists.hover();
    if(width===1920 || width===390)await page.screenshot({path:`artifacts/whatsapp-09-after-${width}.png`});
    await panel.getByRole("button",{name:"Exportar conversa",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Exportar conversa",exact:true}); await dialog.waitFor();
    assert.ok((await dialog.textContent()).includes("mensagens carregadas"));
    assert.equal(await dialog.getByRole("button",{name:"Cancelar",exact:true}).evaluate(button=>button===document.activeElement),true);
    await page.keyboard.press("Escape"); assert.equal(await dialog.count(),0);
    assert.equal(await panel.getByRole("button",{name:"Exportar conversa",exact:true}).evaluate(button=>button===document.activeElement),true);
    await panel.getByRole("button",{name:"Exportar conversa",exact:true}).click();
    const download=page.waitForEvent("download"); await dialog.getByRole("button",{name:"Exportar",exact:true}).click();
    const file=await download; const text=await readFile(await file.path(),"utf8");
    assert.ok(text.includes("mensagens carregadas")); assert.ok(text.includes("Lindaiane"));
    assert.equal(await dialog.count(),0);
    await panel.getByRole("button",{name:"Fechar informações",exact:true}).click(); assert.equal(await panel.count(),0);
    await page.getByTitle("Dados do contato",{exact:true}).click();
    const groupName=(await commonGroup.getAttribute("aria-label")).replace("Abrir grupo ","");
    await commonGroup.click(); assert.equal(await panel.count(),0);
    await page.locator(".wai-chat-title").getByText(groupName,{exact:true}).waitFor();
    assert.equal(await page.locator(".wai-contact-trigger").evaluate(button=>button===document.activeElement),true);
    assert.deepEqual(errors,[]); assert.deepEqual(mutations,[]);
    console.log(`PASS contact details ${width} @${scale}: geometry, common group, lists, export, focus and safe demo`);
    await page.close();
  }
} finally { await browser.close(); }
