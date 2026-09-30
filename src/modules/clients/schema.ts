import { z } from "zod";

export const clientInputSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(160, "Use até 160 caracteres no nome."),
  notes: z.string().trim().max(10000, "Use até 10.000 caracteres nas observações."),
});
export type ClientItem = { id: string; name: string; notes: string | null; archived_at: string | null; updated_at: string };
export type ClientResult = { error: string } | { client: ClientItem };

