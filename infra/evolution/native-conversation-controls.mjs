// Extend the deployed inbox bridge without replacing unrelated service code.
import {readFileSync,writeFileSync} from 'node:fs';
let source=readFileSync('dist/main.js','utf8');
function replace(anchor,value){if(source.split(anchor).length!==2)throw Error('Unsupported conversation bridge: '+anchor);source=source.replace(anchor,value);}
const methods=String.raw`
async igrowConversationSnapshot() {
  const names=['regular_low','regular_high'];
  const response=await this.client.query({tag:'iq',attrs:{to:'s.whatsapp.net',xmlns:'w:sync:app:state',type:'set'},content:[{tag:'sync',attrs:{},content:names.map(name=>({tag:'collection',attrs:{name,version:'0',return_snapshot:'true'}}))}]});
  const collections=await Pt.extractSyncdPatches(response,{}),records=[];
  const key=async id=>(await this.client.authState.keys.get('app-state-sync-key',[id]))[id];
  for(const name of names){
    const collection=collections[name];
    if(!collection?.snapshot||collection.hasMorePatches)throw new f('IGROW_CHAT_STATE_UNAVAILABLE_'+name+'_'+Boolean(collection?.snapshot)+'_'+Boolean(collection?.hasMorePatches));
    const decoded=await Pt.decodeSyncdSnapshot(name,collection.snapshot,key,undefined,true);
    const mutations={...decoded.mutationMap};
    if(collection.patches?.length){const patches=await Pt.decodePatches(name,collection.patches,decoded.state,key,{},undefined,undefined,true);Object.assign(mutations,patches.mutationMap);}
    for(const mutation of Object.values(mutations))records.push({...mutation,collection:name});
  }
  records.igrowAliasPhones=new Map();return records;
}
async igrowReadConversation(peer, snapshot) {
  const phone=peer.endsWith('@lid')?await this.mappedPhoneJid(peer):peer;
  if(peer.endsWith('@lid')&&!phone)throw new f('IGROW_CHAT_IDENTITY_UNAVAILABLE');
  const records=snapshot||await this.igrowConversationSnapshot();
  const aliases=new Set([peer,phone]);
  for(const record of records){const jid=record.index?.[1];if(typeof jid==='string'&&jid.endsWith('@lid')){if(!records.igrowAliasPhones.has(jid))records.igrowAliasPhones.set(jid,await this.mappedPhoneJid(jid));if(records.igrowAliasPhones.get(jid)===phone)aliases.add(jid);}}
  const state={jid:phone||peer,pinned:false,archived:false,markedUnread:false,favorite:false,favoritesSupported:false};
  let favoritesRecord;
  for(const record of records){
    const value=record.syncAction?.value;
    if(value?.favoritesAction){favoritesRecord=record;state.favorite=(value.favoritesAction.favorites||[]).some(item=>aliases.has(item.id));state.favoritesSupported=Number.isInteger(record.syncAction.version)&&record.syncAction.version>0;}
    if(!aliases.has(record.index?.[1]))continue;
    if(value?.pinAction){state.pinned=value.pinAction.pinned===true;state.jid=record.index[1];}
    if(value?.archiveChatAction)state.archived=value.archiveChatAction.archived===true;
    if(value?.markChatAsReadAction)state.markedUnread=value.markChatAsReadAction.read===false;
  }
  return {state,aliases,favoritesRecord,records};
}
igrowConversation(data) {
  const operation=this.igrowMuteQueue.then(async()=>{
    if(this.stateConnection.state!=='open')throw new f('WhatsApp disconnected');
    if(data.peers){const records=await this.igrowConversationSnapshot(),states=[];for(const peer of data.peers){const result=await this.igrowReadConversation(peer,records);states.push({peer,...result.state});}return {states};}
    const before=await this.igrowReadConversation(data.peer);
    if(!data.action)return before.state;
    const field={pin:'pinned',archive:'archived',unread:'markedUnread',favorite:'favorite'}[data.action];
    if(!field||before.state[field]!==data.expected)throw new f('IGROW_CHAT_STATE_CHANGED');
    if(data.action==='pin'){
      if(data.value&&before.records.filter(record=>record.syncAction?.value?.pinAction?.pinned===true).length>=3)throw new f('IGROW_CHAT_PIN_LIMIT');
      await this.client.chatModify({pin:data.value},before.state.jid);
    } else if(data.action==='favorite'){
      const record=before.favoritesRecord;
      if(!before.state.favoritesSupported||!record||typeof this.client.appPatch!=='function')throw new f('IGROW_FAVORITES_UNAVAILABLE');
      const favorites=(record.syncAction.value.favoritesAction.favorites||[]).filter(item=>!before.aliases.has(item.id));
      if(data.value)favorites.push({id:before.state.jid});
      await this.client.appPatch({type:record.collection,index:record.index,apiVersion:record.syncAction.version,operation:0,syncAction:{favoritesAction:{favorites}}});
    } else {
      if(!data.lastMessages?.length)throw new f('IGROW_CHAT_MESSAGE_RANGE_UNAVAILABLE');
      const lastMessages=data.lastMessages.map(item=>({...item,key:{...item.key,remoteJid:before.state.jid}}));
      await this.client.chatModify(data.action==='archive'?{archive:data.value,lastMessages}:{markRead:!data.value,lastMessages},before.state.jid);
    }
    for(let attempt=0;attempt<4;attempt++){
      const after=await this.igrowReadConversation(data.peer);
      if(after.state[field]===data.value)return after.state;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new f('IGROW_CHAT_NOT_CONFIRMED');
  });
  this.igrowMuteQueue=operation.catch(()=>undefined);return operation;
}
`;
replace('async igrowReadMute(e){',methods+'async igrowReadMute(e){');
replace('async igrowMute({instanceName:s},e){','async igrowConversation({instanceName:s},e){return this.waMonitor.waInstances[s].igrowConversation(e)}async igrowMute({instanceName:s},e){');
replace('this.router.post(this.routerPath("igrowMute"),',String.raw`this.router.post(this.routerPath("igrowConversation"),...e,async(t,o)=>{
  const data=t.body;
  const validPeer=peer=>typeof peer==='string'&&/^[0-9]{8,20}@(s[.]whatsapp[.]net|lid|g[.]us)$/.test(peer);
  if(!data||!(validPeer(data.peer)||(Array.isArray(data.peers)&&data.peers.length<=500&&data.peers.every(validPeer)&&data.action===undefined))||Object.keys(data).some(key=>!['peer','peers','action','value','expected','lastMessages'].includes(key))||
    (data.action!==undefined&&(!['pin','archive','unread','favorite'].includes(data.action)||typeof data.value!=='boolean'||typeof data.expected!=='boolean'))||
    (data.lastMessages!==undefined&&(!Array.isArray(data.lastMessages)||data.lastMessages.length>100||data.lastMessages.some(item=>!item?.key||typeof item.key.id!=='string'||typeof item.key.fromMe!=='boolean'||!Number.isSafeInteger(item.messageTimestamp)))))return o.status(400).json({error:'Invalid conversation control'});
  const result=await this.dataValidate({request:t,schema:null,ClassRef:Ye,execute:instance=>rt.igrowConversation(instance,data)});return o.status(200).json(result);
}).post(this.routerPath("igrowMute"),`);
writeFileSync('dist/main.js',source);
