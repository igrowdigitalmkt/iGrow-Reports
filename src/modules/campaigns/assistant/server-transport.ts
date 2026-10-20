import { askAssistant } from "./server/actions";
import type { AssistantTransport } from "./transport";

/** Transporte real: chama a ação autenticada do servidor. Falha de rede ou de execução vira um erro tipado, nunca uma resposta. */
export const serverTransport: AssistantTransport = {
  async send(request) {
    try { return await askAssistant(request); }
    catch { return { ok: false, code: "model_error", possibleCharge: true, message: "Não foi possível confirmar a resposta e a chamada pode ter sido processada. Aguarde um instante antes de tentar de novo." }; }
  },
};
