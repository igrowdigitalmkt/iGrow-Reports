import { describe, expect, it } from "vitest";
import { replyMediaKind, replyWindow } from "@/modules/whatsapp/reply-rules";

const now = new Date("2026-10-07T15:00:00Z");

describe("janela de 24 horas", () => {
  it("QR Code responde sempre", () => {
    expect(replyWindow("qr", null, now).open).toBe(true);
  });
  it("número oficial só até 24 h depois da última mensagem do cliente", () => {
    expect(replyWindow("official", "2026-10-07T10:00:00Z", now)).toEqual({ open: true, closesAt: "2026-10-08T10:00:00.000Z" });
    expect(replyWindow("official", "2026-10-06T14:59:00Z", now).open).toBe(false);
    expect(replyWindow("official", null, now).open).toBe(false);
  });
});

describe("arquivos aceitos", () => {
  it("foto, vídeo, áudio e documentos", () => {
    expect(replyMediaKind("image/jpeg", "qr")).toBe("image");
    expect(replyMediaKind("image/webp", "official")).toBe("document");
    expect(replyMediaKind("video/mp4", "official")).toBe("video");
    expect(replyMediaKind("audio/ogg; codecs=opus", "qr")).toBe("audio");
    expect(replyMediaKind("application/pdf", "official")).toBe("document");
    expect(replyMediaKind("application/x-msdownload", "qr")).toBeNull();
  });
});
