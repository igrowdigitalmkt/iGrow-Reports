import { expect, it } from "vitest";
import { commercialButtons, commercialButtonsFromRef } from "@/modules/whatsapp/commercial-messages";
import { parseEvolutionMessage } from "@/modules/whatsapp/inbox-parse";
it("preserves business labels and safe link destinations without executable URLs", () => {
  const templateMessage={hydratedTemplate:{hydratedContentText:"Texto",hydratedButtons:[{urlButton:{displayText:"Acesse o site",url:"https://example.com"}},{quickReplyButton:{displayText:"Parar promoções",id:"stop"}},{urlButton:{displayText:"Invalid",url:"javascript:alert(1)"}}]}};
  const buttons=commercialButtons({templateMessage});
  expect(buttons).toEqual([{label:"Acesse o site",href:"https://example.com/"},{label:"Parar promoções"},{label:"Invalid"}]);
  expect(commercialButtonsFromRef({type:"templateMessage",data:{buttons}})).toEqual(buttons);
  expect(parseEvolutionMessage({event:"messages.upsert",data:{key:{id:"id",remoteJid:"5586999999999@s.whatsapp.net"},message:{templateMessage}}})?.mediaRef).toEqual({type:"templateMessage",data:{buttons}});
});
it("does not expose companion-masked message action data", () => {
  expect(commercialButtons({templateMessage:{hydratedTemplate:{maskLinkedDevices:true,hydratedButtons:[{urlButton:{displayText:"Sensitive",url:"https://example.com/private"}}]}}})).toEqual([]);
});
