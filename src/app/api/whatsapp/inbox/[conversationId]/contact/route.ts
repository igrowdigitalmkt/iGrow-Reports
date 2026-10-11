import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { qrContact } from "@/modules/whatsapp-qr/server";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const name = z.string().trim().min(1).max(200).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const editSchema = z.object({ fullName: name, firstName: name.pipe(z.string().max(100)), expectedFullName: z.string().min(1).max(200) }).strict();
type Edit = z.infer<typeof editSchema>;

async function execute(conversationId: string, edit?: Edit) {
  if (!z.uuid().safeParse(conversationId).success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp") || (edit && context.role === "viewer"))
    return Response.json({ error: "Sem permissão para esta ação." }, { status: 403, headers });
  const { data: chat, error } = await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id,is_group")
    .eq("agency_id", context.agency.id).eq("id", conversationId).maybeSingle();
  if (error || !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  if (chat.channel !== "qr" || chat.is_group) return Response.json({ error: "Edição disponível para contatos salvos no WhatsApp conectado por QR Code." }, { status: 409, headers });
  try {
    const contact = await qrContact(context.agency.id, chat.remote_id, edit);
    if (edit) {
      const service = createSupabaseServiceClient();
      if (!service) return Response.json({ error: "O nome foi enviado ao WhatsApp, mas a atualização na iGrow está pendente. Atualize a conversa." }, { status: 503, headers });
      const result = await service.from("whatsapp_conversations").update({ title: contact.fullName, updated_at: new Date().toISOString() })
        .eq("agency_id", context.agency.id).eq("id", chat.id).eq("channel", "qr").eq("is_group", false).select("id");
      if (result.error || !result.data?.length) return Response.json({ error: "O nome foi enviado ao WhatsApp, mas a atualização na iGrow está pendente. Atualize a conversa." }, { status: 503, headers });
    }
    return Response.json({ ...contact, canEdit: context.role !== "viewer" && contact.canEdit }, { headers });
  } catch (error) {
    if (error instanceof EvolutionError && error.code === "IGROW_CONTACT_NOT_SAVED")
      return Response.json({ error: "Este contato ainda não está salvo na agenda do WhatsApp. A edição está disponível apenas para contatos salvos." }, { status: 409, headers });
    if (error instanceof EvolutionError && error.code === "IGROW_CONTACT_CHANGED")
      return Response.json({ error: "O nome mudou no WhatsApp. Feche e abra a edição para carregar o nome atual." }, { status: 409, headers });
    return Response.json({ error: "Não foi possível confirmar os dados no WhatsApp. Reabra a edição antes de tentar novamente." }, { status: 502, headers });
  }
}
export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) { return execute((await params).conversationId); }
export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const body = editSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Nome inválido." }, { status: 400, headers });
  return execute((await params).conversationId, body.data);
}
