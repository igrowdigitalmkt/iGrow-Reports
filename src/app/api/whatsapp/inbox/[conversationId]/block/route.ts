import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { qrContactBlock } from "@/modules/whatsapp-qr/server";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

async function execute(conversationId: string, blocked?: boolean) {
  if (!z.uuid().safeParse(conversationId).success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp") || (blocked !== undefined && context.role === "viewer"))
    return Response.json({ error: "Sem permissão para esta ação." }, { status: 403, headers });
  const { data: chat, error } = await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id,is_group")
    .eq("agency_id", context.agency.id).eq("id", conversationId).maybeSingle();
  if (error || !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  if (chat.channel !== "qr" || chat.is_group) return Response.json({ error: "Bloqueio disponível apenas para contatos do WhatsApp conectado por QR Code." }, { status: 409, headers });
  try { return Response.json(await qrContactBlock(context.agency.id, chat.remote_id, blocked), { headers }); }
  catch (error) {
    if (error instanceof EvolutionError && error.code === "IGROW_CONTACT_SELF") {
      if (blocked === undefined) return Response.json({ blocked: false, canBlock: false }, { headers });
      return Response.json({ error: "Você não pode bloquear o próprio número." }, { status: 409, headers });
    }
    return Response.json({ error: "Não foi possível confirmar o bloqueio no WhatsApp. Atualize o estado antes de tentar novamente." }, { status: 502, headers });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  return execute((await params).conversationId);
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const body = z.object({ blocked: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  return execute((await params).conversationId, body.data.blocked);
}
