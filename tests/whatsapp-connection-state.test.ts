import { describe, expect, it } from "vitest";
import { isConfirmedQrLogout } from "@/modules/whatsapp-qr/connection-state";

describe("sessão do WhatsApp", () => {
  it("diferencia revogação definitiva e oscilação temporária", () => {
    expect(isConfirmedQrLogout({ event: "connection.update", data: { state: "close", statusReason: 401 } })).toBe(true);
    expect(isConfirmedQrLogout({ event: "CONNECTION_UPDATE", data: { state: "close", statusReason: 403 } })).toBe(true);
    expect(isConfirmedQrLogout({ event: "CONNECTION_UPDATE", data: { state: "close", statusReason: 428 } })).toBe(false);
    expect(isConfirmedQrLogout({ event: "CONNECTION_UPDATE", data: { state: "close", statusReason: 440 } })).toBe(false);
    expect(isConfirmedQrLogout({ event: "CONNECTION_UPDATE", data: { state: "connecting", statusReason: 401 } })).toBe(false);
    expect(isConfirmedQrLogout({ event: "messages.upsert", data: { state: "close", statusReason: 401 } })).toBe(false);
  });
});
