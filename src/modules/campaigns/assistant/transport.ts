import type { AssistantAskRequest, AssistantAskResult } from "./request";

/**
 * Porta da comunicação com o backend. Envia só IDENTIFICADORES, a pergunta e um histórico curto (nunca um objeto de contexto como
 * prova de autorização) e recebe um resultado tipado. O navegador NUNCA fala com o provedor de IA: a implementação chama uma ação
 * do servidor, que revalida sessão, organização, permissão, cliente, conta, entidade e período, monta os fatos e responde.
 * Operações pedidas por IA no futuro passam pelos mecanismos seguros já existentes (política, aprovação e executor); nada é
 * executado a partir do chat.
 */
export interface AssistantTransport { send(request: AssistantAskRequest): Promise<AssistantAskResult> }
