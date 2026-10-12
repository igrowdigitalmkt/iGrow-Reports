// Version-checked hotfix for the deployed 2.3.7 native-settings-3 bundle.
// Preserve authenticated list metadata, rather than converting modern lists to legacy labels.
import { readFileSync, writeFileSync } from "node:fs";
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error(`Unsupported provider implementation: ${from.slice(0, 70)}`);
  return source.replace(from, to);
}
const sdkPath = "node_modules/baileys/lib/Utils/chat-utils.js";
let sdk = readFileSync(sdkPath, "utf8");
sdk = replaceOnce(sdk, "deleted: mod.addLabel.deleted", `deleted: mod.addLabel.deleted,
                    orderIndex: mod.addLabel.orderIndex,
                    isActive: mod.addLabel.isActive,
                    type: mod.addLabel.type,
                    isImmutable: mod.addLabel.isImmutable,
                    muteEndTimeMs: mod.addLabel.muteEndTimeMs`);
sdk = replaceOnce(sdk, "predefinedId: predefinedId ? String(predefinedId) : undefined", "predefinedId: predefinedId ? String(predefinedId) : undefined,\n            igrowLabelAction: { ...action.labelEditAction }");
writeFileSync(sdkPath, sdk);
const bundlePath = "dist/main.js";
let bundle = readFileSync(bundlePath, "utf8");
bundle = replaceOnce(bundle, 'this.igrowLabelsReady=!1;', 'this.igrowLabelsReady=!1;this.igrowNativeLists=new Map;');
bundle = replaceOnce(bundle, '"labels.edit":async e=>{', '"labels.edit":async e=>{if(e.igrowLabelAction)this.igrowNativeLists.set(e.id,{...e.igrowLabelAction});');
bundle = replaceOnce(bundle, 'await this.prismaRepository.label.deleteMany({where:{instanceId:this.instanceId}})', 'this.igrowNativeLists.clear();await this.prismaRepository.label.deleteMany({where:{instanceId:this.instanceId}})');
bundle = replaceOnce(bundle, 'let e=await this.client.authState.keys.get("app-state-sync-version",["regular","regular_low"]),t=', 'await this.client.resyncAppState(["regular","regular_low"],!1);await this.eventProcessingQueue;let e=await this.client.authState.keys.get("app-state-sync-version",["regular","regular_low"]),t=');
bundle = replaceOnce(bundle, 'return{labels:o,syncVersions:t,chats:', 'return{labels:o.map(label=>({...label,...this.igrowNativeLists.get(label.id),id:label.id})),syncVersions:t,chats:');
bundle = replaceOnce(bundle, 'n={id:i,name:e.name?.trim(),color:e.color,deleted:!!e.deleted}', 'n={type:5,isActive:!0,...(!e.id?{orderIndex:Math.max(0,...o.labels.map(label=>Number(label.orderIndex??label.id)||0))+1}:{}),...this.igrowNativeLists.get(i),id:i,name:e.name?.trim(),color:e.color,deleted:!!e.deleted}');
bundle = replaceOnce(bundle, 'if(await this.client.addLabel(this.client.user.id,n),n.deleted)', 'if(await this.client.addLabel(this.client.user.id,n),this.igrowNativeLists.set(i,{...n}),n.deleted)');
writeFileSync(bundlePath, bundle);
