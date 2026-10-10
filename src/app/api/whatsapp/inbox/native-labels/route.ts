import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { EvolutionClient, EvolutionError, evolutionConfig } from "@/modules/whatsapp-qr/evolution";
import { instanceNameFor } from "@/modules/whatsapp-qr/format";
import { labelChatKey, labelColorIndex, nativeLabelId, WHATSAPP_LABEL_COLORS } from "@/modules/whatsapp/native-labels";
import { canonicalQrPeers } from "@/modules/whatsapp-qr/peer-identity";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const id = z.string().regex(/^wa:[0-9]{1,9}$/);
const color = z.string().refine(value => labelColorIndex(value) >= 0);
const chatIds = z.array(z.uuid()).max(250).refine(ids => new Set(ids).size === ids.length);
const fields = { name: z.string().trim().min(1).max(40), color, conversationIds: chatIds.optional() };

async function access(context: Awaited<ReturnType<typeof requireAgencyContext>>, write: boolean) {
  if (write && context.role === "viewer") return { response: Response.json({ error: "Seu perfil só pode consultar as etiquetas." }, { status: 403, headers }) };
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp"))
    return { response: Response.json({ error: "Seu perfil não pode alterar as etiquetas do WhatsApp." }, { status: 403, headers }) };
  const config = evolutionConfig();
  if (!config) return { response: Response.json({ error: "WhatsApp indisponível." }, { status: 503, headers }) };
  const service = createSupabaseServiceClient();
  if (!service) return { response: Response.json({ error: "WhatsApp indisponível." }, { status: 503, headers }) };
  // Keep native labels bound to this pairing, exactly like its messages and peer aliases.
  const { data: guard, error } = await service.from("whatsapp_qr_reset_guards")
    .select("blocked,fresh_after").eq("agency_id", context.agency.id).maybeSingle();
  if (error || guard?.blocked) return { response: Response.json({ error: "Reconecte o WhatsApp para consultar etiquetas." }, { status: 503, headers }) };
  const client = new EvolutionClient(config);
  const instance = instanceNameFor(context.agency.id);
  if (await client.state(instance) !== "open") return { response: Response.json({ error: "Conecte o WhatsApp por QR Code." }, { status: 409, headers }) };
  return { context, client, instance, service, epoch: guard?.fresh_after };
}
type Access = Extract<Awaited<ReturnType<typeof access>>, { context: unknown }>;
async function snapshot(scope: Access) {
  const result = await scope.client.labelSnapshot(scope.instance);
  if (!Array.isArray(result?.labels) || !Array.isArray(result.chats)) throw Error("Snapshot inválido");
  const { data: chats, error } = await scope.context.supabase.from("whatsapp_conversations")
    .select("id,remote_id").eq("agency_id", scope.context.agency.id).eq("channel_key", "qr").limit(1000);
  if (error) throw error;
  const peers = await canonicalQrPeers(scope.service, scope.context.agency.id, scope.epoch, result.chats.map(chat => chat.remoteJid));
  const byPeer = new Map((chats ?? []).map(chat => [chat.remote_id, chat.id]));
  // WhatsApp also transmits its built-in filters as IDs 1–3 with an LRM-prefixed name.
  // Those filters already have dedicated tabs and must not appear as editable labels.
  const labels = result.labels.filter(label => !(Number(label.id) <= 3 && label.name.startsWith("\u200e"))).map((label, index) => ({
    id: "wa:" + label.id, name: label.name, color: WHATSAPP_LABEL_COLORS[Number(label.color)] ?? WHATSAPP_LABEL_COLORS[0], sortOrder: index,
    conversationIds: [...new Set(result.chats.filter(chat => chat.labels.includes(label.id)).flatMap(chat => {
      const chatId = byPeer.get(labelChatKey(peers.get(chat.remoteJid) ?? chat.remoteJidAlt ?? chat.remoteJid));
      return chatId ? [chatId] : [];
    }))],
  }));
  return { labels, chats: result.chats };
}
async function ownChats(scope: Access, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await scope.context.supabase.from("whatsapp_conversations").select("id,remote_id")
    .eq("agency_id", scope.context.agency.id).eq("channel_key", "qr").in("id", ids);
  if (error || data?.length !== ids.length) throw Error("Conversa inválida para esse número.");
  return data.map(chat => ({ id: chat.id, jid: chat.remote_id.includes("@") ? chat.remote_id : chat.remote_id + "@s.whatsapp.net" }));
}
const failure = (error: unknown) => error instanceof EvolutionError && error.code === "IGROW_LABEL_STATE_UNAVAILABLE"
  ? Response.json({ error: "O WhatsApp não conseguiu compartilhar suas etiquetas nesta conexão. Reconecte o número por QR Code para tentar sincronizar novamente." }, { status: 409, headers })
  : Response.json({ error: "Não foi possível sincronizar com o WhatsApp. Atualize e tente novamente." }, { status: 503, headers });

export async function GET() {
  const context = await requireAgencyContext();
  try { const scope = await access(context, false); if (scope.response) return scope.response;
    return Response.json({ lists: (await snapshot(scope)).labels, source: "whatsapp" }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const parsed = z.object(fields).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Etiqueta inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  try {
    const scope = await access(context, true); if (scope.response) return scope.response;
    const chats = await ownChats(scope, parsed.data.conversationIds ?? []);
    const label = await scope.client.editLabel(scope.instance, { name: parsed.data.name, color: labelColorIndex(parsed.data.color) });
    for (const chat of chats) await scope.client.setChatLabel(scope.instance, chat.jid, label.id, true);
    return Response.json({ id: "wa:" + label.id }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  const parsed = z.object({ id, name: fields.name.optional(), color: color.optional(), conversationId: z.uuid().optional(),
    member: z.boolean().optional(), conversationIds: chatIds.optional(), sortOrder: z.number().int().optional() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Etiqueta inválida." }, { status: 400, headers });
  const body = parsed.data;
  if (body.sortOrder !== undefined) return Response.json({ error: "A ordem das etiquetas é definida pelo WhatsApp." }, { status: 422, headers });
  const context = await requireAgencyContext();
  try {
    const scope = await access(context, true); if (scope.response) return scope.response;
    const current = (await snapshot(scope)).labels.find(label => label.id === body.id);
    if (!current) return Response.json({ error: "Etiqueta não encontrada no WhatsApp." }, { status: 404, headers });
    const labelId = nativeLabelId(body.id)!;
    // Validate every peer before sending any mutation to the linked WhatsApp device.
    const requested = body.conversationIds;
    const remove = requested?.length !== undefined ? current.conversationIds.filter(chat => !requested.includes(chat)) : [];
    const add = requested?.filter(chat => !current.conversationIds.includes(chat)) ?? [];
    const single = body.conversationId && body.member !== undefined ? [body.conversationId] : [];
    const peers = new Map((await ownChats(scope, [...new Set([...remove, ...add, ...single])])).map(chat => [chat.id, chat.jid]));
    if (body.name !== undefined || body.color !== undefined)
      await scope.client.editLabel(scope.instance, { id: labelId, name: body.name ?? current.name, color: labelColorIndex(body.color ?? current.color) });
    for (const chat of remove) await scope.client.setChatLabel(scope.instance, peers.get(chat)!, labelId, false);
    for (const chat of add) await scope.client.setChatLabel(scope.instance, peers.get(chat)!, labelId, true);
    if (single.length) await scope.client.setChatLabel(scope.instance, peers.get(single[0])!, labelId, body.member!);
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  const parsed = id.safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return Response.json({ error: "Etiqueta inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  try { const scope = await access(context, true); if (scope.response) return scope.response;
    const labelId = nativeLabelId(parsed.data)!;
    const current = await snapshot(scope);
    if (!current.labels.some(label => label.id === parsed.data))
      return Response.json({ error: "Etiqueta não encontrada no WhatsApp." }, { status: 404, headers });
    // Remove native associations too: WhatsApp can retain orphan links after a label tombstone.
    for (const chat of current.chats.filter(chat => chat.labels.includes(labelId)))
      await scope.client.setChatLabel(scope.instance, chat.remoteJid, labelId, false);
    await scope.client.editLabel(scope.instance, { id: labelId, deleted: true });
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
