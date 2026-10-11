import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {transpileModule,ScriptTarget} from "typescript";
import {expect,it,vi} from "vitest";
const installer=readFileSync("infra/evolution/native-chat-settings.mjs","utf8");
const methods=installer.match(/const methods=`([\s\S]*?)`;/)?.[1];
if(!methods)throw Error("Missing native bridge");
const peer="5586999999999@s.whatsapp.net";
function fixture() {
 const snapshot=vi.fn().mockResolvedValue({state:{},mutationMap:{delete:{index:["deleteChat",peer],syncAction:{value:{deleteChatAction:{}}}},mute:{index:["mute",peer],syncAction:{value:{muteAction:{muted:false}}}}}});
 const sdk={extractSyncdPatches:vi.fn().mockResolvedValue({regular_high:{snapshot:{},patches:[]}}),decodeSyncdSnapshot:snapshot,decodePatches:vi.fn()};
 const code=transpileModule(`class Bridge {${methods}}; Bridge;`,{compilerOptions:{target:ScriptTarget.ES2022}}).outputText;
 const Constructor=runInNewContext(code,{IgrowAppState:sdk,BadRequestException:Error,setTimeout:(cb:()=>void)=>cb()});
 const service=new Constructor();service.stateConnection={state:"open"};service.mappedPhoneJid=vi.fn().mockResolvedValue(null);
 service.client={query:vi.fn().mockResolvedValue({}),authState:{keys:{get:vi.fn(),set:vi.fn()}},chatModify:vi.fn(),resyncAppState:vi.fn(),ev:{emit:vi.fn()}};
 return {service,sdk,snapshot};
}
it("authenticates snapshots without applying deletion actions, persisting keys or emitting events",async()=>{
 const {service,snapshot}=fixture();expect(await service.igrowMute({peer})).toEqual({muted:false,until:null});
 expect(snapshot.mock.calls[0][4]).toBe(true);
 expect(service.client.chatModify).not.toHaveBeenCalled();expect(service.client.resyncAppState).not.toHaveBeenCalled();expect(service.client.ev.emit).not.toHaveBeenCalled();expect(service.client.authState.keys.set).not.toHaveBeenCalled();
});
it("refuses incomplete snapshots, unknown LIDs and stale settings before mutations",async()=>{
 const {service,sdk}=fixture();sdk.extractSyncdPatches.mockResolvedValueOnce({regular_high:{snapshot:{},hasMorePatches:true}});
 await expect(service.igrowMute({peer})).rejects.toThrow("UNAVAILABLE");
 await expect(service.igrowMute({peer:"123456789@lid"})).rejects.toThrow("IDENTITY");
 await expect(service.igrowMute({peer,duration:"off",expectedMuted:true,expectedUntil:null})).rejects.toThrow("CHANGED");
 expect(service.client.chatModify).not.toHaveBeenCalled();expect(await service.igrowMute({peer})).toEqual({muted:false,until:null});
});
it("requires native echo and only writes the mute field",async()=>{
 const {service}=fixture();await expect(service.igrowMute({peer,duration:"8h",expectedMuted:false,expectedUntil:null})).rejects.toThrow("NOT_CONFIRMED");
 expect(service.client.chatModify).toHaveBeenCalledTimes(1);expect(Object.keys(service.client.chatModify.mock.calls[0][0])).toEqual(["mute"]);
});
it("uses an absolute millisecond deadline and confirms the native snapshot echo",async()=>{
 const {service,snapshot}=fixture();let deadline:number|null=null;
 service.client.chatModify.mockImplementation(async({mute}:{mute:number|null})=>{deadline=mute;snapshot.mockResolvedValue({state:{},mutationMap:{mute:{index:["mute",peer],syncAction:{value:{muteAction:{muted:mute!==null,muteEndTimestamp:mute}}}}}});});
 const before=Date.now();const result=await service.igrowMute({peer,duration:"8h",expectedMuted:false,expectedUntil:null});
 expect(deadline).toBeGreaterThanOrEqual(before+8*60*60*1000);expect(deadline).toBeLessThanOrEqual(Date.now()+8*60*60*1000);expect(result).toEqual({muted:true,until:deadline});
});
