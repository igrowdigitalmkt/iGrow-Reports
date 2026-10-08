import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EvolutionClient } from "@/modules/whatsapp-qr/evolution";
import { markQrRead } from "@/modules/whatsapp-qr/server";
import { parseIncomingRead } from "@/modules/whatsapp-qr/opt-out";

const workspace = "4c49714e-3aec-409a-8c5a-d2dae02f2e3b";
const lid = "26461578752134@lid";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("leitura sincronizada com WhatsApp QR", () => {
  it("envia o JID da conversa, inclusive quando o histórico não inclui IDs recebidos", async () => {
    const calls: Array<{path: string; body: { chat?: string; readMessages?: Array<{remoteJid:string;id:string}>}}> = [];
    const client = new EvolutionClient({ url: "https://bridge.example.test", key: "test" }, (async (url,init) => {
      calls.push({path:String(url),body:JSON.parse(String(init?.body))});
      return new Response("{}", {status:201});
    }) as typeof fetch);
    await client.markRead("igrow-test", [], lid);
    expect(calls[0].body).toEqual({chat:lid,readMessages:[]});
    await client.markRead("igrow-test", [{id:"inbound",remoteJid:lid,fromMe:false}],lid);
    expect(calls[1].body).toMatchObject({chat:lid,readMessages:[{id:"inbound",remoteJid:lid}]});
  });

  it("não ignora o chat com contador de não lidas e sem histórico recebido", async () => {
    vi.stubEnv("EVOLUTION_API_URL","https://bridge.example.test");
    vi.stubEnv("EVOLUTION_API_KEY","test");
    const requests: Array<{url:string;body:unknown}> = [];
    vi.stubGlobal("fetch", vi.fn(async (url:string, init: RequestInit) => {
      requests.push({url,body:JSON.parse(String(init.body))});
      return new Response('{"read":"success"}',{status:201});
    }));
    await markQrRead(workspace, lid, []);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({chat:lid,readMessages:[]});
  });

  it("aceita recibo de leitura de mensagem recebida em outro dispositivo", () => {
    expect(parseIncomingRead({event:"MESSAGES_UPDATE",data:{keyId:"incoming",fromMe:false,status:"READ"}}))
      .toEqual({messageId:"incoming"});
    expect(parseIncomingRead({event:"MESSAGES_UPDATE",data:{keyId:"sent",fromMe:true,status:"READ"}}))
      .toBeNull();
  });
});
