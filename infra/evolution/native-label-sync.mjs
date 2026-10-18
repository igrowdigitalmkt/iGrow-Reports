// Version-checked fix for 2.3.7-native-conversation-1. Labels and their chat
// associations belong to regular; regular_low may legitimately have no state.
import { readFileSync, writeFileSync } from "node:fs";

const methods=String.raw`
igrowLabelSyncProjection = undefined;
igrowLabelSyncCapture = undefined;
igrowLabelSyncPending = undefined;
igrowLabelSyncRetryAt = 0;
igrowLabelSyncClient = undefined;
igrowLabelOperationQueue = Promise.resolve();

igrowQueueLabelOperation(run) {
  const result = this.igrowLabelOperationQueue.then(run);
  this.igrowLabelOperationQueue = result.catch(() => {});
  return result;
}

handleLabel(input) {
  // A reader submitted after this write must not join a pre-write snapshot.
  this.igrowLabelSyncPending = undefined;
  return this.igrowQueueLabelOperation(async () => {
    await this.igrowSyncNativeLabels();
    return this.igrowHandleLabel(input);
  });
}

igrowEditLabel(input) {
  this.igrowLabelSyncPending = undefined;
  return this.igrowQueueLabelOperation(() => this.igrowEditLabelOriginal(input));
}

igrowConfirmNativeLabel(client, label) {
  if (this.client !== client) throw new f('IGROW_LABEL_STATE_UNAVAILABLE');
  this.igrowCaptureNativeLabel(label);
}

igrowConfirmNativeLabelAssociation(client, chatId, labelId, type) {
  if (this.client !== client) throw new f('IGROW_LABEL_STATE_UNAVAILABLE');
  this.igrowCaptureNativeLabelAssociation({ type, association: { type: 'label_jid', chatId, labelId } });
}

igrowCaptureNativeLabel(label) {
  const projection = this.igrowLabelSyncCapture || this.igrowLabelSyncProjection;
  if (!projection || !label || label.id == null) return;
  const id = String(label.id);
  const native = label.igrowLabelAction || label;
  if (native.deleted || label.deleted) {
    projection.labels.delete(id);
    for (const members of projection.chats.values()) members.delete(id);
    return;
  }
  projection.labels.set(id, { ...native, id, name: native.name ?? label.name, color: native.color ?? label.color });
}

igrowCaptureNativeLabelAssociation(event) {
  const projection = this.igrowLabelSyncCapture || this.igrowLabelSyncProjection;
  const association = event?.association;
  if (!projection || association?.type !== 'label_jid' || typeof association.chatId !== 'string'
    || association.labelId == null || !['add', 'remove'].includes(event.type)) return;
  const members = projection.chats.get(association.chatId) || new Set();
  const id = String(association.labelId);
  if (event.type === 'add') members.add(id);
  else members.delete(id);
  projection.chats.set(association.chatId, members);
}

async igrowLabelSnapshot() {
  if (!this.igrowLabelSyncPending) {
    const pending = this.igrowQueueLabelOperation(() => this.igrowSyncNativeLabels()).finally(() => {
      if (this.igrowLabelSyncPending === pending) this.igrowLabelSyncPending = undefined;
    });
    this.igrowLabelSyncPending = pending;
  }
  return this.igrowLabelSyncPending;
}

async igrowSyncNativeLabels() {
  if (this.stateConnection.state !== 'open') throw new f('WhatsApp disconnected');
  const client = this.client;
  if (this.igrowLabelSyncClient !== client) {
    this.igrowLabelSyncClient = client;
    this.igrowLabelsReady = false;
    this.igrowLabelSyncProjection = undefined;
    this.igrowLabelSyncRetryAt = 0;
  }
  if (Date.now() < this.igrowLabelSyncRetryAt) throw new f('IGROW_LABEL_STATE_UNAVAILABLE');
  const before = await client.authState.keys.get('app-state-sync-version', ['regular']);
  const rebuild = !this.igrowLabelsReady || !this.igrowLabelSyncProjection || !Number.isInteger(before.regular?.version);
  const previous = this.igrowLabelSyncProjection;
  // Publish an authenticated snapshot only after the entire sync succeeds. A
  // failed read must never erase cached labels, chat links or message history.
  this.igrowLabelSyncCapture = rebuild ? { labels: new Map(), chats: new Map() } : {
    labels: new Map(previous.labels),
    chats: new Map([...previous.chats].map(([jid, members]) => [jid, new Set(members)])),
  };
  let states;
  try {
    if (rebuild && before.regular != null) {
      await client.authState.keys.set({ 'app-state-sync-version': { regular: null } });
    }
    await client.resyncAppState(['regular'], rebuild);
    await this.eventProcessingQueue;
    states = await client.authState.keys.get('app-state-sync-version', ['regular']);
    if (this.client !== client || !Number.isInteger(states.regular?.version)) throw new f('IGROW_LABEL_STATE_UNAVAILABLE');
    this.igrowLabelSyncProjection = this.igrowLabelSyncCapture;
    this.igrowLabelsReady = true;
    this.igrowLabelSyncRetryAt = 0;
  } catch {
    this.igrowLabelsReady = false;
    this.igrowLabelSyncRetryAt = Date.now() + 30_000;
    throw new f('IGROW_LABEL_STATE_UNAVAILABLE');
  } finally {
    this.igrowLabelSyncCapture = undefined;
  }
  const projection = this.igrowLabelSyncProjection;
  const labels = [...projection.labels.values()].map(label => ({ ...label }));
  const chats = [...projection.chats].map(([remoteJid, members]) => ({
    remoteJid, labels: [...members].filter(id => projection.labels.has(id)),
  })).filter(chat => chat.labels.length);
  return {
    labels,
    syncVersions: { regular: states.regular.version },
    chats: await Promise.all(chats.map(async chat => ({ ...chat, remoteJidAlt: await this.mappedPhoneJid(chat.remoteJid) }))),
  };
}
`;

function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error("Unsupported native-label provider implementation");
  return source.replace(from, to);
}

const path = "dist/main.js";
let source = readFileSync(path, "utf8");
if (source.includes("igrowLabelSyncProjection")) throw Error("Native-label sync fix already installed");
const start = source.indexOf("async igrowLabelSnapshot(){");
const end = source.indexOf("igrowEditLabel(", start);
const original = source.slice(start, end);
if (start < 0 || end < start || !original.includes('regular_low:null')
  || !original.includes('IGROW_LABEL_STATE_UNAVAILABLE') || !original.includes('this.igrowNativeLists.clear()')) {
  throw Error("Unsupported native-label snapshot implementation");
}
// emitOwnEvents is disabled in this provider. Mirror only successful SDK
// acknowledgements, before optional Prisma persistence can fail. Keep all
// label reads/writes ordered without enabling unrelated own-message events.
source = source.slice(0, start) + methods + source.slice(end);
source = replaceOnce(source, 'igrowEditLabel(e){let t=this.igrowLabelQueue.then(async()=>{let o=await this.igrowLabelSnapshot();',
  'igrowEditLabelOriginal(e){let t=this.igrowLabelQueue.then(async()=>{let o=await this.igrowSyncNativeLabels();const igrowClient=this.client;');
source = replaceOnce(source, 'await this.client.addLabel(this.client.user.id,n),this.igrowNativeLists.set(i,{...n})',
  'await igrowClient.addLabel(igrowClient.user.id,n),this.igrowConfirmNativeLabel(igrowClient,n),this.igrowNativeLists.set(i,{...n})');
source = replaceOnce(source, 'async handleLabel(e){', 'async igrowHandleLabel(e){const igrowClient=this.client;');
source = replaceOnce(source, 'await this.client.addChatLabel(o.jid,e.labelId),await this.addLabel(',
  'await igrowClient.addChatLabel(o.jid,e.labelId),this.igrowConfirmNativeLabelAssociation(igrowClient,o.jid,e.labelId,"add"),await this.addLabel(');
source = replaceOnce(source, 'await this.client.removeChatLabel(o.jid,e.labelId),await this.removeLabel(',
  'await igrowClient.removeChatLabel(o.jid,e.labelId),this.igrowConfirmNativeLabelAssociation(igrowClient,o.jid,e.labelId,"remove"),await this.removeLabel(');
source = replaceOnce(source, '"labels.edit":async e=>{', '"labels.edit":async e=>{this.igrowCaptureNativeLabel(e);');
source = replaceOnce(source, '"labels.association":async(e,t)=>{', '"labels.association":async(e,t)=>{this.igrowCaptureNativeLabelAssociation(e);');
// All version checks run before writing; labels, sessions and app-state keys
// are never accessed by this installer. It modifies the provider code only.
writeFileSync(path, source);
