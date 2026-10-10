/** Reference 03: isolated demo only; no WhatsApp mutations. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname, "/demo/whatsapp");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.WA_QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  for (const [width, height, scale] of [[1920,1080,1],[1366,768,1],[1024,768,1],[390,844,1],[1536,864,1.25],[1280,720,1.5]]) {
    const page = await browser.newPage({ viewport: {width,height}, deviceScaleFactor:scale });
    const errors = [], mutations = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if(request.method()==="POST" && request.url().includes("/api/whatsapp/")) mutations.push(request.url()); });
    await page.goto(base, {waitUntil:"domcontentloaded"});
    await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
    const incoming = page.locator(".wai-bubble-row.is-in").last();
    await incoming.locator(".wai-bubble-stack").hover();
    await incoming.getByRole("button",{name:"Mais opções da mensagem"}).click();
    assert.equal(await page.getByRole("dialog",{name:"Ações da mensagem"}).getByRole("button",{name:"Apagar",exact:true}).count(),0,"incoming messages have no delete control");
    await page.getByRole("dialog",{name:"Ações da mensagem"}).getByRole("button",{name:"Selecionar",exact:true}).click();
    const checks = page.locator(".wai-select-message-check input");
    for (let i=0;i<await checks.count();i++) await checks.nth(i).check();
    const toolbar = page.getByRole("toolbar",{name:"Mensagens selecionadas"});
    await toolbar.getByText("3 itens selecionados",{exact:true}).waitFor();
    assert.equal(await toolbar.locator("button:visible").count(),5,"cancel + four actions");
    assert.ok(await toolbar.getByRole("button",{name:"Apagar mensagens",exact:true}).isDisabled(),"incoming messages cannot be deleted");
    assert.ok(await toolbar.getByRole("button",{name:"Baixar arquivos selecionados"}).isDisabled(),"text selection cannot download");
    const geometry = await page.locator(".wai-bubble-row").evaluateAll(rows=>rows.map(row=>{
      const rect=row.getBoundingClientRect(), input=row.querySelector("input"), check=input.getBoundingClientRect();
      return {x:rect.x,right:rect.right,checkX:check.x,checkWidth:check.width,checked:input.checked,bg:getComputedStyle(row).backgroundColor,checkBg:getComputedStyle(input).backgroundColor};
    }));
    assert.ok(geometry.every(row=>row.checked && row.bg==="rgb(21, 22, 22)" && row.checkBg==="rgb(29, 191, 96)"),"selected highlight and checked color");
    assert.ok(geometry.every(row=>Math.abs(row.checkX-geometry[0].checkX)<1),"incoming/outgoing checkbox alignment");
    const pane = await page.locator(".wai-messages").boundingBox();
    assert.ok(geometry.every(row=>Math.abs(row.x-pane.x)<1 && row.right<=pane.x+pane.width+1),"highlight spans full conversation width");
    if(width===1920){assert.equal((await toolbar.boundingBox()).height,77);await page.screenshot({path:"artifacts/whatsapp-03-after-1920.png"});}
    if(width===390)await page.screenshot({path:"artifacts/whatsapp-03-after-390.png"});
    // Clicking the gutter toggles the row; it must not require a bubble click.
    const first = page.locator(".wai-bubble-row").first();
    await first.click({position:{x:4,y:10}});
    assert.equal(await checks.first().isChecked(),false);
    await toolbar.getByText("2 itens selecionados",{exact:true}).waitFor();
    await checks.first().check();
    await toolbar.getByRole("button",{name:"Encaminhar mensagens",exact:true}).click();
    await page.getByRole("dialog",{name:"Encaminhar mensagens para",exact:true}).getByRole("button",{name:"Fechar encaminhamento"}).click();
    await toolbar.getByRole("button",{name:"Cancelar seleção"}).click();
    assert.equal(await checks.count(),0,"cancel restores composer and removes checkboxes");
    await page.locator(".wai-composer").waitFor();
    if(width===1920){
      // Reference 01 regression: one outgoing message keeps the compact bar
      // and its existing deletion confirmation, despite multiple-selection CSS.
      await page.locator(".wai-row").filter({hasText:"Paulo Henrique"}).first().click();
      const outgoing=page.locator(".wai-bubble-row.is-out").last();
      await outgoing.locator(".wai-bubble-stack").hover();
      await outgoing.getByRole("button",{name:"Mais opções da mensagem"}).click();
      await page.getByRole("dialog",{name:"Ações da mensagem"}).getByRole("button",{name:"Selecionar",exact:true}).click();
      assert.equal(await toolbar.locator("button:visible").count(),2,"single selection retains cancel + delete");
      await toolbar.getByRole("button",{name:"Apagar mensagens",exact:true}).click();
      const deletion=page.getByRole("dialog",{name:"Apagar mensagens",exact:true});
      await deletion.getByRole("button",{name:"Apagar para todos",exact:true}).waitFor();
      const box=await deletion.boundingBox();
      assert.ok(Math.abs(box.x+box.width/2-width/2)<1,"deletion stays centered");
      await deletion.getByRole("button",{name:"Cancelar",exact:true}).click();
      await toolbar.getByRole("button",{name:"Cancelar seleção"}).click();
    }
    if(width>760){
      await page.getByRole("button",{name:"Opções de conversas",exact:true}).click();
      await page.getByRole("menuitem",{name:"Selecionar conversas",exact:true}).click();
      await page.getByRole("button",{name:"Opções das conversas selecionadas",exact:true}).click();
      assert.equal(await page.getByRole("menuitem",{name:/Limpar|Apagar conversa/}).count(),0,"conversation clearing/deletion must not be offered");
    }
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    console.log(`PASS ${width}×${height} @${scale}: selection, full rows, alignment, permissions, forward, cancel`);
    await page.close();
  }
}finally{await browser.close();}
