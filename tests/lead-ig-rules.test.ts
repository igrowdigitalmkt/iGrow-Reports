import { describe, expect, it } from "vitest";
import { cleanHandle, instagramFirstMessage, parseInstagramMessages, shouldCaptureInstagram } from "@/modules/lead-pages/ig-rules";

const payload = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: "17841400000000001", time: 1762100000, messaging }] });
const event = (patch: Record<string, unknown> = {}) => ({ sender: { id: "17841499999999999" }, recipient: { id: "17841400000000001" }, timestamp: 1762100000123, message: { mid: "m_abc", text: "  Olá,  quero   saber o valor " }, ...patch });

describe("Instagram Direct como canal de leads", () => {
  it("lê as mensagens recebidas e limpa o texto", () => {
    const [message] = parseInstagramMessages(payload([event()]));
    expect(message).toMatchObject({ igAccountId: "17841400000000001", senderId: "17841499999999999", messageId: "m_abc", text: "Olá, quero saber o valor", echo: false, hasAttachment: false });
    expect(message!.at).toBe(new Date(1762100000123).toISOString());
  });
  it("ignora avisos de outro tipo e eventos sem remetente ou id", () => {
    expect(parseInstagramMessages({ object: "page", entry: [] })).toEqual([]);
    expect(parseInstagramMessages(payload([event({ sender: {} }), event({ message: { text: "x" } })]))).toEqual([]);
    expect(parseInstagramMessages("x")).toEqual([]);
  });
  it("lê também o formato com changes", () => {
    const body = { object: "instagram", entry: [{ id: "17841400000000001", changes: [{ field: "messages", value: event() }, { field: "comments", value: event() }] }] };
    expect(parseInstagramMessages(body)).toHaveLength(1);
  });
  it("eco da própria conta nunca vira lead", () => {
    const [echo] = parseInstagramMessages(payload([event({ message: { mid: "m_e", text: "oi", is_echo: true } })]));
    expect(shouldCaptureInstagram(echo!)).toBe(false);
    const [self] = parseInstagramMessages(payload([event({ sender: { id: "17841400000000001" } })]));
    expect(shouldCaptureInstagram(self!)).toBe(false);
    const [real] = parseInstagramMessages(payload([event()]));
    expect(shouldCaptureInstagram(real!)).toBe(true);
  });
  it("mídia sem texto vira rótulo; usuário inválido é descartado", () => {
    const [media] = parseInstagramMessages(payload([event({ message: { mid: "m_f", attachments: [{ type: "image" }] } })]));
    expect(instagramFirstMessage(media!)).toBe("[mídia]");
    expect(cleanHandle("@maria.silva_1")).toBe("maria.silva_1");
    expect(cleanHandle("<script>")).toBeNull();
    expect(cleanHandle(null)).toBeNull();
  });
});
