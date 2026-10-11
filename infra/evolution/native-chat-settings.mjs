import fs from 'node:fs';
function change(path,anchor,replacement) {
  const source=fs.readFileSync(path,'utf8');
  if(source.split(anchor).length!==2)throw Error('Unexpected native settings anchor: '+path);
  fs.writeFileSync(path,source.replace(anchor,replacement));
}
const service='src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts';
change(service,"import { getCollectionsDto }", "import * as IgrowAppState from 'baileys';\nimport { getCollectionsDto }");
const methods=`
  private igrowMuteQueue: Promise<unknown> = Promise.resolve();
  private async igrowReadMute(peer: string) {
    const result = await this.client.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', xmlns: 'w:sync:app:state', type: 'set' },
      content: [{ tag: 'sync', attrs: {}, content: [{ tag: 'collection', attrs: { name: 'regular_high', version: '0', return_snapshot: 'true' } }] }] });
    const collections = await IgrowAppState.extractSyncdPatches(result, {});
    const collection = collections.regular_high;
    if (!collection?.snapshot || collection.hasMorePatches) throw new BadRequestException('IGROW_MUTE_STATE_UNAVAILABLE');
    const key = async (id: string) => (await this.client.authState.keys.get('app-state-sync-key', [id]))[id];
    const decoded = await IgrowAppState.decodeSyncdSnapshot('regular_high', collection.snapshot, key, undefined, true);
    const mutations: Record<string, any> = { ...decoded.mutationMap };
    if (collection.patches?.length) {
      const patches = await IgrowAppState.decodePatches('regular_high', collection.patches, decoded.state, key, {}, undefined, undefined, true);
      Object.assign(mutations, patches.mutationMap);
    }
    // Decode only. Do not persist versions, emit events or apply old chat/message mutations.
    const phone = peer.endsWith('@lid') ? await this.mappedPhoneJid(peer) : peer;
    if (peer.endsWith('@lid') && !phone) throw new BadRequestException('IGROW_MUTE_IDENTITY_UNAVAILABLE');
    for (const mutation of Object.values(mutations)) {
      const action = mutation.syncAction?.value?.muteAction;
      const jid = mutation.index?.[1];
      if (!action || mutation.index?.[0] !== 'mute' || typeof jid !== 'string') continue;
      const match = jid === peer || jid === phone || (jid.endsWith('@lid') && await this.mappedPhoneJid(jid) === phone);
      if (!match) continue;
      const raw = action.muteEndTimestamp;
      const until = raw == null ? null : Number(typeof raw.toNumber === 'function' ? raw.toNumber() : raw);
      if (until !== null && !Number.isSafeInteger(until)) throw new BadRequestException('IGROW_MUTE_STATE_UNAVAILABLE');
      return { jid, muted: action.muted === true && (until === -1 || (until !== null && until > Date.now())), until };
    }
    return { jid: phone || peer, muted: false, until: null };
  }
  public igrowMute(data: { peer: string; duration?: '8h' | '7d' | 'always' | 'off'; expectedUntil?: number | null; expectedMuted?: boolean }) {
    const operation = this.igrowMuteQueue.then(async () => {
      if (this.stateConnection.state !== 'open') throw new BadRequestException('WhatsApp disconnected');
      const before = await this.igrowReadMute(data.peer);
      if (data.duration !== undefined) {
        if (before.muted !== data.expectedMuted || before.until !== data.expectedUntil) throw new BadRequestException('IGROW_MUTE_CHANGED');
        const mute = data.duration === 'off' ? null : data.duration === 'always' ? -1 : Date.now() + (data.duration === '8h' ? 8 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000);
        await this.client.chatModify({ mute }, before.jid);
        for (let attempt = 0; attempt < 4; attempt++) {
          const after = await this.igrowReadMute(data.peer);
          if (after.muted === (mute !== null) && (mute === null || after.until === mute)) return { muted: after.muted, until: after.until };
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new BadRequestException('IGROW_MUTE_NOT_CONFIRMED');
      }
      return { muted: before.muted, until: before.until };
    });
    this.igrowMuteQueue = operation.catch(() => undefined);
    return operation;
  }
`;
change(service,'  private igrowLabelsReady = false;',methods+'\n  private igrowLabelsReady = false;');
const controller='src/api/controllers/label.controller.ts';
change(controller,'  public async igrowSnapshot(',`  public async igrowMute({ instanceName }: InstanceDto, data: any) { return this.waMonitor.waInstances[instanceName].igrowMute(data); }\n\n  public async igrowSnapshot(`);
const router='src/api/routes/label.router.ts';
change(router,"      .post(this.routerPath('igrowContact'),",`      .post(this.routerPath('igrowMute'), ...guards, async (req, res) => {
        const data = req.body;
        if (!data || typeof data.peer !== 'string' || !/^[0-9]{8,20}@(s[.]whatsapp[.]net|lid|g[.]us)$/.test(data.peer) ||
          Object.keys(data).some(key => !['peer', 'duration', 'expectedUntil', 'expectedMuted'].includes(key)) ||
          (data.duration !== undefined && (!['8h', '7d', 'always', 'off'].includes(data.duration) || typeof data.expectedMuted !== 'boolean' ||
            !(data.expectedUntil === null || Number.isSafeInteger(data.expectedUntil))))) return res.status(400).json({ error: 'Invalid mute request' });
        const response = await this.dataValidate<LabelDto>({ request: req, schema: null, ClassRef: LabelDto,
          execute: (instance) => labelController.igrowMute(instance, data) });
        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('igrowContact'),`);
