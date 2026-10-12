import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const source=readFileSync("infra/evolution/native-conversation-controls.mjs","utf8");
const methods=source.split("const methods=String.raw`")[1].split("`;")[0];
const Bridge=new Function("f", `return class {${methods}}`)(Error);
describe("native conversation bridge",()=>{
  it("confirms pin changes after sending them",async()=>{
    const bridge=new Bridge();let pinned=false;
    Object.assign(bridge,{igrowMuteQueue:Promise.resolve(),stateConnection:{state:"open"},client:{chatModify:async(change:{pin:boolean})=>{pinned=change.pin;}},
      igrowReadConversation:async()=>({state:{jid:"test@lid",pinned,archived:false,markedUnread:false},records:[]})});
    expect((await bridge.igrowConversation({peer:"test@lid",action:"pin",value:true,expected:false})).pinned).toBe(true);
    expect((await bridge.igrowConversation({peer:"test@lid",action:"pin",value:false,expected:true})).pinned).toBe(false);
  });
  it("keeps valid peer states when identity errors are wrapped by the API",async()=>{
    const bridge=new Bridge();
    Object.assign(bridge,{igrowMuteQueue:Promise.resolve(),stateConnection:{state:"open"},client:{signalRepository:{lidMapping:{getLIDsForPNs:async()=>[]}}},igrowConversationSnapshot:async()=>[],
      igrowReadConversation:async(peer:string)=>{if(peer==="missing@lid")throw {getResponse:()=>({message:["IGROW_CHAT_IDENTITY_UNAVAILABLE"]})};return {state:{pinned:true,archived:false,markedUnread:false}};}});
    const result=await bridge.igrowConversation({peers:["missing@lid","valid@lid"]});
    expect(result.states).toEqual([{peer:"valid@lid",pinned:true,archived:false,markedUnread:false}]);
  });
});
