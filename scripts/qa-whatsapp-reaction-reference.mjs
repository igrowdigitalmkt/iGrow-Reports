/** Reference 04: reaction picker in the isolated demo. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.WA_QA_URL || "http://127.0.0.1:3158/demo/whatsapp";
assert.equal(new URL(base).pathname, "/demo/whatsapp");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  for (const [width,height,scale] of [[1920,1080,1],[1366,768,1],[1024,768,1],[390,844,1],[1536,864,1.25],[1280,720,1.5]]) {
    const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:scale});
    const errors=[], mutations=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("request",request=>{if(request.method()==="POST" && request.url().includes("/api/whatsapp/"))mutations.push(request.url());});
    await page.goto(base,{waitUntil:"domcontentloaded"});
    await page.locator(".wai-row").filter({hasText:"Diretoria Colégio"}).click();
    const incoming=page.locator(".wai-bubble-row.is-in").last();
    await incoming.locator(".wai-bubble-stack").hover();
    await incoming.getByRole("button",{name:"Reagir à mensagem",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Reagir à mensagem",exact:true});
    await dialog.getByRole("button",{name:"Mais emojis",exact:true}).click();
    const picker=dialog.getByRole("group",{name:"Emojis para reagir"});
    await picker.waitFor();
    const search=picker.getByRole("textbox",{name:"Pesquisar reação"});
    assert.equal(await search.evaluate(el=>el===document.activeElement),true);
    assert.equal(await picker.getByRole("tab").count(),8);
    assert.equal(await dialog.locator(".wai-message-quick-reactions").count(),0);
    const first=await picker.locator(".wai-emoji-grid button img").evaluateAll(images=>images.map(image=>image.alt));
    assert.deepEqual(first.slice(0,16),["😀","😃","😄","😁","😆","🥹","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉"]);
    await picker.locator(".wai-emoji-grid button img").first().evaluate(image => image.decode());
    assert.ok(await picker.locator(".wai-emoji-grid button img").first().evaluate(image => image.naturalWidth === 64));
    const box=await dialog.boundingBox();
    assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,JSON.stringify(box));
    if(width===1920){assert.equal(box.width,488);assert.equal(box.height,404);await page.screenshot({path:"artifacts/whatsapp-04-after-1920.png"});}
    if(width===390)await page.screenshot({path:"artifacts/whatsapp-04-after-390.png"});
    await search.fill("  coracao  ");
    assert.ok((await picker.locator(".wai-emoji-grid button").count())>0,"accent-insensitive search");
    await search.fill("xyznaoexiste");
    await picker.getByRole("status").getByText("Nenhum emoji encontrado.").waitFor();
    await picker.getByRole("tab",{name:"Animais e natureza"}).click();
    assert.equal(await search.inputValue(),"");
    await page.keyboard.press("ArrowRight");
    assert.equal(await picker.getByRole("tab",{name:"Comidas"}).getAttribute("aria-selected"),"true");
    await page.keyboard.press("Home");
    assert.equal(await picker.getByRole("tab",{name:"Smileys e pessoas"}).getAttribute("aria-selected"),"true");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(),0);
    await page.getByRole("button",{name:"Emojis",exact:true}).click();
    const composer=page.getByRole("dialog",{name:"Emojis",exact:true});
    assert.equal(await composer.getByRole("tab").count(),9);
    await composer.getByRole("textbox",{name:"Pesquisar emoji"}).fill("cafe");
    await composer.getByRole("button",{name:"☕ café",exact:true}).click();
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
    console.log(`OK ${width}x${height} scale ${scale}`);
    await page.close();
  }
} finally {await browser.close();}
