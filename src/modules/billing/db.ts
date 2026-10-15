import "server-only";

export type RpcResult = { data: unknown; error: { code?: string | null; message: string } | null };
/** O mínimo do cliente Supabase usado pela camada financeira (permite testes sem banco). */
export interface BillingDb { rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult> }

export class BillingDbError extends Error {
  constructor(readonly rpcName: string, readonly code: string | null, message: string) {
    super(`${rpcName}: ${message}`);
    this.name = "BillingDbError";
  }
}

export function asBillingDb(client: unknown): BillingDb { return client as BillingDb; }

export async function callRpc<T>(db: BillingDb, name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new BillingDbError(name, error.code ?? null, error.message);
  return data as T;
}
