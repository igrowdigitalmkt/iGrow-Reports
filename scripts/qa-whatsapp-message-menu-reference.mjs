/** Reference 05: message menu, isolated demo with no real mutations. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base=process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname,"/demo/whatsapp");
await mkdir("artifacts",{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
try {
  for(const [width,height,scale] of [[1920,1080,1],[1366,768,1],[1024,768,1],[390,844,1],[1536,864,1.25],[1280,720,1.5]]) {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:scale});
    const errors=[], mutations=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("request",request=>{if(request.method()==="POST" && request.url().includes("/api/whatsapp/"))mutations.push(request.url());});
    await page.goto(base,{waitUntil:"domcontentloaded"});
    await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
    const incoming=page.locator(".wai-bubble-row.is-in").last();
    const trigger=incoming.getByRole("button",{name:"Mais opções da mensagem"});
    const menu=page.getByRole("dialog",{name:"Ações da mensagem"});
    async function open(){await incoming.locator(".wai-bubble-stack").hover();await trigger.click();await menu.waitFor();}
    await open();
    const list=menu.locator(".wai-message-menu-list");
    assert.deepEqual(await list.locator("button").allTextContents(),["Responder","Copiar","Reagir","Encaminhar","Fixar","Favoritar","Dados da mensagem","Selecionar"]);
    const pill=await menu.locator(".wai-message-quick-reactions").boundingBox(),box=await list.boundingBox(), popup=await menu.boundingBox();
    const zoom=await page.locator(".wai-shell").evaluate(el=>Number(getComputedStyle(el).zoom)||1);
    assert.ok(Math.abs(pill.width-306*zoom)<1);assert.ok(Math.abs(pill.height-52*zoom)<1);assert.ok(Math.abs(box.width-270*zoom)<1);
    assert.ok(Math.abs(box.y-pill.y-pill.height-6*zoom)<1);
    assert.equal(await list.locator("hr").count(),1);
    assert.ok(popup.x>=0 && popup.y>=0 && popup.x+popup.width<=width+1 && popup.y+popup.height<=height+1,JSON.stringify(popup));
    if(width===1920)await page.screenshot({path:"artifacts/whatsapp-05-after-1920.png"});
    if(width===390)await page.screenshot({path:"artifacts/whatsapp-05-after-390.png"});
    assert.equal(await list.getByRole("button",{name:"Responder",exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press("ArrowDown");
    assert.equal(await list.getByRole("button",{name:"Copiar",exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press("End");
    assert.equal(await list.getByRole("button",{name:"Selecionar",exact:true}).evaluate(el=>el===document.activeElement),true);
    assert.ok(await list.getByRole("button",{name:"Encaminhar",exact:true}).isDisabled());
    assert.equal(await list.getByRole("button",{name:"Apagar",exact:true}).count(),0,"incoming deletion remains unavailable");
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(),0);assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    await open();await list.getByRole("button",{name:"Reagir",exact:true}).click();
    await menu.getByRole("group",{name:"Emojis para reagir"}).waitFor();
    await page.keyboard.press("Escape");
    await open();await list.getByRole("button",{name:"Responder",exact:true}).click();
    await page.locator(".wai-reply-banner").waitFor();
    assert.equal(await menu.count(),0);
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    console.log(`PASS ${width}x${height} @${scale}: menu geometry, keyboard, reaction, reply, permissions`);
    await page.close();
  }
} finally {await browser.close();}
