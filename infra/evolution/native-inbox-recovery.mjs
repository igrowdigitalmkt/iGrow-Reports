// Targeted 2.3.7-native-lists-4 fix. Preserve native contact names in signed events.
import { readFileSync, writeFileSync } from "node:fs";
let source = readFileSync("dist/main.js", "utf8");
function replace(from, to) {
  if (source.split(from).length !== 2) throw Error(`Unsupported inbox bridge: ${from.slice(0,60)}`);
  source = source.replace(from, to);
}
replace('igrowSavedName:e[r].igrowContactAction?.fullName,lidJid:e[r].igrowContactAction?.lidJid,remoteJidAlt:e[r].igrowContactAction?.pnJid',
  'igrowSavedName:e[r].igrowContactAction?.fullName??e[r].name,igrowVerifiedName:e[r].verifiedName,igrowProfileName:e[r].notify,lidJid:e[r].igrowContactAction?.lidJid??e[r].lid,remoteJidAlt:e[r].igrowContactAction?.pnJid??e[r].phoneNumber');
replace('o.filter(w=>!!w.notify||!!w.name).map(w=>({id:w.id,name:w.name??w.notify}))',
  'o.filter(w=>!!w.notify||!!w.name||!!w.verifiedName).map(w=>({...w,id:w.id,name:w.name,notify:w.notify,verifiedName:w.verifiedName}))');
const metadata = 'igrowSavedName:e[r].igrowContactAction?.fullName??e[r].name,igrowVerifiedName:e[r].verifiedName,igrowProfileName:e[r].notify,lidJid:e[r].igrowContactAction?.lidJid??e[r].lid,remoteJidAlt:e[r].igrowContactAction?.pnJid??e[r].phoneNumber';
replace('this.sendDataWebhook("contacts.update",t)', `this.sendDataWebhook("contacts.update",t.map((n,r)=>({...n,${metadata}})))`);
replace('this.sendDataWebhook("contacts.update",o)', `this.sendDataWebhook("contacts.update",o.map((n,r)=>({...n,${metadata}})))`);
replace('for(let w of o)w.id&&(w.notify||w.name)&&l.set(w.id,{name:w.name??w.notify,jid:w.id})',
  'for(let w of o)w.id&&(w.notify||w.name||w.verifiedName)&&l.set(w.id,{name:w.name??w.verifiedName??w.notify,jid:w.id})');
replace('r===R.proto.HistorySync.HistorySyncType.ON_DEMAND&&console.log("received on-demand history sync, messages=",e)',
  'r===R.proto.HistorySync.HistorySyncType.ON_DEMAND&&this.logger.info("Received on-demand history sync")');
writeFileSync("dist/main.js", source);
