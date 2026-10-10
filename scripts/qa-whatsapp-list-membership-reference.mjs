import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base=process.env.WA_QA_URL||"http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname,"/demo/whatsapp");
await mkdir("artifacts",{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
try {
 for(const [width,height,scale] of [[1920,1080,1],[1366,768,1],[1024,768,1],[390,844,1],[1536,864,1.25],[1280,720,1.5]]) {
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:scale});
  const errors=[],mutations=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(["POST","PATCH","DELETE"].includes(request.method())&&request.url().includes("/api/whatsapp/"))mutations.push(request.url());});
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
  const trigger=page.getByRole("button",{name:"Adicionar conversa à lista"});
  const dialog=page.getByRole("dialog",{name:"Adicionar à lista",exact:true});
  assert.ok((await trigger.textContent()).includes("4 selecionadas"));
  assert.equal(await trigger.locator(".wai-chat-list-colors>span:visible").count(),2);
  await trigger.click();await dialog.waitFor();
  assert.equal(await dialog.getByRole("checkbox").count(),4);
  for(const check of await dialog.getByRole("checkbox").all()){assert.ok(await check.isChecked());assert.ok(await check.isDisabled());}
  const box=await dialog.boundingBox(),zoom=await page.locator(".wai-shell").evaluate(el=>Number(getComputedStyle(el).zoom)||1);
  assert.ok(Math.abs(box.width-345*zoom)<1,JSON.stringify(box));
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify(box));
  const bg=await dialog.getByRole("checkbox").first().evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(bg,"rgb(250, 250, 250)");
  if(width===1920){assert.equal(box.height,368);await page.screenshot({path:"artifacts/whatsapp-08-after-1920.png"});}
  if(width===390)await page.screenshot({path:"artifacts/whatsapp-08-after-390.png"});
  await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await trigger.click();await page.mouse.click(4,height-100);assert.equal(await dialog.count(),0);
  await trigger.click();await dialog.getByRole("button",{name:"Gerenciar listas",exact:true}).click();
  await page.getByRole("region",{name:"Gerenciar listas"}).waitFor();
  await page.getByRole("button",{name:"Fechar listas"}).click();
  if(width<=760)await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
  await trigger.click();await dialog.getByRole("button",{name:"Nova lista",exact:true}).click();
  await page.locator(".wai-custom-editor").waitFor();
  assert.equal(await dialog.count(),0);
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator(".wai-row").filter({hasText:"Lindaiane Lívia"}).click();
  assert.ok((await trigger.textContent()).includes("Adicionar à lista"));
  await trigger.click();
  for(const check of await dialog.getByRole("checkbox").all())assert.equal(await check.isChecked(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  console.log(`PASS ${width}x${height} @${scale}: membership geometry, checks, colors, focus, management`);
  await page.close();
 }
} finally {await browser.close();}
