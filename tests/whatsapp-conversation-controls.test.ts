import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";
const state={pinned:false,archived:false,markedUnread:false,favorite:false,favoritesSupported:true};
describe("native conversation controls",()=>{
  it("rejects a success response that did not confirm the requested native change",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json(state));
    await expect(client.conversationControl("session","5511999990000@s.whatsapp.net",{action:"favorite",value:true,expected:false})).rejects.toThrow("não confirmou a alteração");
  });
  it("rejects malformed native state instead of inventing defaults",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json({favorite:true}));
    await expect(client.conversationControl("session","5511999990000@s.whatsapp.net")).rejects.toThrow("não confirmou o estado");
  });
  it("rejects bulk states outside the requested session peers",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json({states:[{...state,peer:"other@s.whatsapp.net"}]}));
    await expect(client.conversationStates("session",["5511999990000@s.whatsapp.net"])).rejects.toThrow("Estado nativo inválido");
  });
});
