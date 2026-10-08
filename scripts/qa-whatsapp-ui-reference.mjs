/**
 * Visual + interaction smoke test for the three user-supplied UI reference files.
 * Run with ENABLE_DEMO=true and Next dev/server running, for example:
 *   WA_QA_URL=http://localhost:3158/demo/whatsapp node scripts/qa-whatsapp-ui-reference.mjs
 * This uses the product's isolated demo and never sends WhatsApp messages.
 */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base=process.env.WA_QA_URL||"http://localhost:3158/demo/whatsapp";
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.WA_QA_CHROME||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
 try{
  for(const [width,height,railWidth] of [[1536,864,80],[1366,768,80],[1024,768,65],[390,844,55]]){
   const p=await b.newPage({viewport:{width,height},deviceScaleFactor:1});
   const errors=[];p.on("pageerror",err=>errors.push(err.message));
   await p.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
   await p.locator(".wai-row").first().waitFor({timeout:25000});
   const ui=await p.locator(".wai-shell").evaluate(el=>{
    const rail=el.querySelector(".wai-rail").getBoundingClientRect();
    const head=el.querySelector(".wai-list-head").getBoundingClientRect();
    const search=el.querySelector(".wai-search").getBoundingClientRect();
    return {railWidth:rail.width,headHeight:head.height,searchHeight:search.height,
       bg:getComputedStyle(el.querySelector(".wai-list")).backgroundColor,
       docWidth:document.documentElement.scrollWidth,viewport:window.innerWidth};
   });
   assert.equal(ui.railWidth,railWidth,"responsive left rail");
   assert.equal(ui.headHeight,84,"reference inbox header");
   assert.equal(ui.searchHeight,50,"reference search field");
   assert.equal(ui.bg,"rgb(22, 24, 23)","dark reference palette");
   assert.ok(ui.docWidth<=ui.viewport,"no horizontal document overflow");
   await p.locator(".wai-row").first().click();
   await p.locator(".wai-bubble").first().waitFor({timeout:15000});
   const composer=p.locator(".wai-composer-area");
   const bounds=await composer.boundingBox();
   assert.ok(bounds && bounds.y + bounds.height <= height+5,"composer remains visible");
   await p.getByRole("button",{name:"Pesquisar na conversa"}).click();
   await p.getByRole("textbox",{name:"Pesquisar nesta conversa"}).fill("Bom");
   assert.ok(await p.locator(".wai-chat-search-results button").count()>0,"in-chat search must work");
   await p.getByRole("button",{name:"Fechar pesquisa"}).click();
   const incoming=p.locator(".wai-bubble-row.is-in").last();
   await incoming.locator(".wai-bubble-stack").hover();
   await incoming.getByRole("button",{name:"Mais opções da mensagem"}).click();
   const menu=p.getByRole("dialog",{name:"Ações da mensagem"});
   await menu.waitFor({timeout:3000});
   assert.equal(await menu.getByRole("button",{name:"Apagar",exact:true}).count(),0,"incoming messages cannot be deleted");
   await menu.getByRole("button",{name:"Selecionar"}).click();
   assert.ok(await p.locator(".wai-select-message-check input").count()>0,"selection checkboxes must be present");
   assert.equal(await p.getByRole("toolbar",{name:"Mensagens selecionadas"}).count(),1);
   await p.getByRole("button",{name:"Cancelar seleção"}).click();
   assert.equal(errors.length,0,"no browser errors");
   console.log(`PASS ${width}×${height}: rail ${ui.railWidth}px, header ${ui.headHeight}px, search, menu, selection, no overflow`);
   await p.close();
  }
  // Touchscreen has no hover: an intentional long press must reveal the menu.
  const mobile=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  await mobile.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
  await mobile.locator(".wai-row").first().waitFor({timeout:20000});
  await mobile.locator(".wai-row").first().click();
  const touchMessage=mobile.locator(".wai-bubble-row.is-in").last();
  await touchMessage.scrollIntoViewIfNeeded();
  const touchStyles=await mobile.evaluate(()=>({
    opacity:getComputedStyle(document.querySelector(".wai-message-controls")).opacity,
    composerBottom:document.querySelector(".wai-composer-area").getBoundingClientRect().bottom,
    viewport:innerHeight
  }));
  assert.equal(touchStyles.opacity,"0","no emoji icons permanently visible on mobile");
  assert.ok(touchStyles.composerBottom<=touchStyles.viewport+2,"composer visible with mobile demo banner");
  await touchMessage.dispatchEvent("pointerdown",{pointerType:"touch",bubbles:true});
  await mobile.waitForTimeout(670);
  assert.equal(await mobile.getByRole("dialog",{name:"Ações da mensagem"}).count(),1,"long-press context menu");
  await mobile.close();
  console.log("PASS touchscreen: hidden hover controls, long-press menu, composer visibility");
 }finally{await b.close()}
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
