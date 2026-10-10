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
  page.on("request",request=>{if(request.method()==="POST"&&request.url().includes("/api/whatsapp/"))mutations.push(request.url());});
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
  const trigger=page.getByRole("button",{name:"Pesquisar na conversa",exact:true});
  await trigger.click();
  const panel=page.getByRole("complementary",{name:"Pesquisar mensagens"});
  const search=panel.getByRole("textbox",{name:"Pesquisar nesta conversa"});
  assert.equal(await search.evaluate(el=>el===document.activeElement),true);
  await search.fill("  SEMANA  ");
  const results=panel.getByRole("listitem");
  await results.first().waitFor();assert.equal(await results.count(),2);
  assert.ok((await results.first().textContent()).includes("Os números da semana"),"newest result first");
  assert.deepEqual(await panel.locator("mark").allTextContents(),["semana","semana"]);
  const geometry=await panel.evaluate(el=>{const p=el.getBoundingClientRect(),head=el.closest(".wai-chat").querySelector(".wai-chat-head").getBoundingClientRect();return {x:p.x,right:p.right,width:p.width,headRight:head.right};});
  assert.ok(geometry.x>=0&&geometry.right<=width+1);
  if(width>760)assert.ok(Math.abs(geometry.headRight-geometry.x)<1,"conversation and panel do not overlap");
  if(width===1920){assert.equal(geometry.width,575);await page.screenshot({path:"artifacts/whatsapp-06-after-1920.png"});}
  if(width===390)await page.screenshot({path:"artifacts/whatsapp-06-after-390.png"});
  await panel.getByRole("button",{name:"Limpar pesquisa"}).click();assert.equal(await search.inputValue(),"");
  await search.fill("xyznaoexiste");await panel.getByText("Nenhuma mensagem encontrada.",{exact:true}).waitFor();
  await panel.getByRole("button",{name:"Filtrar mensagens por data"}).click();
  await panel.getByLabel("Data das mensagens",{exact:true}).fill("2000-01-01");
  await panel.getByRole("button",{name:"Limpar pesquisa"}).click();assert.equal(await results.count(),0);
  const today=await page.evaluate(()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;});
  await panel.getByLabel("Data das mensagens",{exact:true}).fill(today);
  assert.equal(await results.count(),3,"date filter finds today's loaded messages");
  await panel.getByRole("button",{name:"Limpar data"}).click();
  await search.fill("semana");await results.first().getByRole("button").click();
  if(width<=760)assert.equal(await panel.count(),0);else {assert.equal(await panel.count(),1);await page.keyboard.press("Escape");}
  assert.equal(await panel.count(),0);
  await trigger.click();assert.equal(await search.inputValue(),"");
  await panel.getByRole("button",{name:"Fechar pesquisa"}).click();
  assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  console.log(`PASS ${width}x${height} @${scale}: geometry, matches, clear, date, navigation, focus`);
  await page.close();
 }
} finally {await browser.close();}
