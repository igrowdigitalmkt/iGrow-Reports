// A missing PostgREST function is a deployment/schema-cache mismatch, not an
// empty collection. Never classify permission, timeout or data errors this way.
export class CollectionSchemaUnavailableError extends Error {
  constructor() {
    super("A análise confirmada está temporariamente indisponível enquanto sua configuração é concluída.");
    this.name = "CollectionSchemaUnavailableError";
  }
}

export function requireCollectionRpc(error: { code?: string } | null) {
  if (error?.code === "PGRST202") throw new CollectionSchemaUnavailableError();
}
