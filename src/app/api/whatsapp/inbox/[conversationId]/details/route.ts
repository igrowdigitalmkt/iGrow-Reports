import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { qrCommonGroups, qrGroupInfo } from "@/modules/whatsapp-qr/server";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const result = z.uuid().safeParse((await params).conversationId);
  if (!result.success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp")) return Response.json({ error: "Sem acesso ao WhatsApp." }, { status: 403, headers });
  const { data: chat, error } = await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id,is_group")
    .eq("agency_id", context.agency.id).eq("id", result.data).maybeSingle();
  if (error || !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  // Media is metadata only. No files or thumbnails are downloaded by opening this panel.
  const { data: media, error: mediaError } = await context.supabase.from("whatsapp_messages")
    .select("id,kind,media_name,sent_at").eq("agency_id", context.agency.id).eq("conversation_id", chat.id)
    .in("kind", ["image", "video", "audio", "document"]).order("sent_at", { ascending: false }).limit(30);
  if (mediaError) return Response.json({ error: "Arquivos indisponíveis." }, { status: 503, headers });
  const group = chat.channel === "qr" && chat.is_group ? await qrGroupInfo(context.agency.id, chat.remote_id) : null;
  const commonGroups = chat.channel === "qr" && !chat.is_group ? await qrCommonGroups(context.agency.id, chat.remote_id) : null;
  return Response.json({ media: media ?? [], group, commonGroups }, { headers });
}
