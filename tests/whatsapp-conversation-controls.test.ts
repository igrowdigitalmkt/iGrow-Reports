import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";
import {conversationMessageRange} from "@/modules/whatsapp/conversation-message-range";
const state={pinned:false,archived:false,markedUnread:false};
describe("native conversation controls",()=>{
  it("does not send a group mutation without a verified incoming sender",()=>{
    expect(conversationMessageRange([{external_id:"in",direction:"in",sent_at:"2026-10-12T12:00:00Z"}],true)).toBeNull();
  });
  it("preserves group sender and stops the range at the latest incoming message",()=>{
    const incoming={external_id:"in",direction:"in" as const,sent_at:"2026-10-12T12:00:00Z",participant_jid:"5511999990000@s.whatsapp.net"};
    const result=conversationMessageRange([{external_id:"out",direction:"out",sent_at:"2026-10-12T12:01:00Z"},incoming,{...incoming,external_id:"older",sent_at:"2026-10-12T11:00:00Z"}],true);
    expect(result?.map(item=>item.key.id)).toEqual(["out","in"]);
    expect(result?.[1]?.key.participant).toBe(incoming.participant_jid);
  });
  it("rejects a success response that did not confirm the requested native change",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json(state));
    await expect(client.conversationControl("session","5511999990000@s.whatsapp.net",{action:"pin",value:true,expected:false})).rejects.toThrow("não confirmou a alteração");
  });
  it("rejects malformed native state instead of inventing defaults",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json({pinned:true}));
    await expect(client.conversationControl("session","5511999990000@s.whatsapp.net")).rejects.toThrow("não confirmou o estado");
  });
  it("rejects bulk states outside the requested session peers",async()=>{
    const client=new EvolutionClient({url:"https://evo.test",key:"test"},async()=>Response.json({states:[{...state,peer:"other@s.whatsapp.net"}]}));
    await expect(client.conversationStates("session",["5511999990000@s.whatsapp.net"])).rejects.toThrow("Estado nativo inválido");
  });
});
