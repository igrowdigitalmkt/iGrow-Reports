import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const uuid = z.uuid();
const name = z.string().trim().min(1).max(40);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const channelKey = z.string().min(1).max(100);
const members = z.array(uuid).max(250).refine(ids => new Set(ids).size === ids.length);

async function ownList(context: Awaited<ReturnType<typeof requireAgencyContext>>, id: string) {
  const { data } = await context.supabase.from("whatsapp_custom_lists")
    .select("id,channel_key").eq("id",id).eq("agency_id",context.agency.id)
    .eq("user_id",context.user.id).maybeSingle();
  return data;
}

export async function GET(request: Request) {
  const context = await requireAgencyContext();
  const key = channelKey.safeParse(new URL(request.url).searchParams.get("channelKey"));
  if (!key.success) return Response.json({ error: "Número inválido." }, { status: 400, headers });
  const { data: lists, error } = await context.supabase.from("whatsapp_custom_lists")
    .select("id,name,color,sort_order")
    .eq("agency_id",context.agency.id).eq("user_id",context.user.id)
    .eq("channel_key",key.data).order("sort_order").order("created_at").limit(60);
  if (error) return Response.json({ error: "Listas indisponíveis. Verifique a migração do banco." }, { status: 503, headers });
  if (!lists?.length) return Response.json({ lists: [] }, { headers });
  const { data: members, error: membersError } = await context.supabase.from("whatsapp_custom_list_members")
    .select("list_id,conversation_id").eq("agency_id",context.agency.id)
    .eq("user_id",context.user.id).in("list_id",lists.map(item => item.id));
  if (membersError) return Response.json({ error: "Não foi possível consultar os contatos das listas." }, { status: 503, headers });
  return Response.json({ lists: lists.map(item => ({
    id: item.id, name: item.name, color: item.color, sortOrder: item.sort_order,
    conversationIds: (members ?? []).filter(member => member.list_id === item.id).map(member => member.conversation_id),
  })) }, { headers });
}

export async function POST(request: Request) {
  const body = z.object({ name, color, channelKey, conversationIds: members.default([]) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Nome ou cor inválidos." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const { count } = await context.supabase.from("whatsapp_custom_lists").select("id", { count: "exact", head: true })
    .eq("agency_id",context.agency.id).eq("user_id",context.user.id).eq("channel_key",body.data.channelKey);
  if ((count ?? 0) >= 40) return Response.json({ error: "Limite de 40 listas por número." }, { status: 400, headers });
  if (body.data.conversationIds.length) {
    const { data: chats, error: chatsError } = await context.supabase.from("whatsapp_conversations")
      .select("id").eq("agency_id",context.agency.id).eq("channel_key",body.data.channelKey)
      .in("id",body.data.conversationIds);
    if (chatsError || chats?.length !== body.data.conversationIds.length)
      return Response.json({ error: "Há contatos que não pertencem ao número selecionado." }, { status: 400, headers });
  }
  const { data, error } = await context.supabase.from("whatsapp_custom_lists").insert({
    agency_id: context.agency.id, user_id: context.user.id, channel_key: body.data.channelKey,
    name: body.data.name, color: body.data.color, sort_order: count ?? 0,
  }).select("id").single();
  if (error) return Response.json({ error: error.code === "23505" ? "Já existe uma lista com esse nome." : "Não foi possível criar a lista." }, { status: 409, headers });
  if (body.data.conversationIds.length) {
    const { error: memberError } = await context.supabase.from("whatsapp_custom_list_members").insert(
      body.data.conversationIds.map(conversationId => ({ agency_id: context.agency.id, user_id: context.user.id,
        list_id: data.id, conversation_id: conversationId })));
    if (memberError) {
      await context.supabase.from("whatsapp_custom_lists").delete().eq("id",data.id);
      return Response.json({ error: "Não foi possível adicionar os contatos à lista." }, { status: 503, headers });
    }
  }
  return Response.json({ id: data.id }, { headers });
}

export async function PATCH(request: Request) {
  const body = z.object({
    id: uuid, name: name.optional(), color: color.optional(),
    sortOrder: z.number().int().min(0).max(200).optional(),
    conversationId: uuid.optional(), member: z.boolean().optional(), conversationIds: members.optional(),
  }).refine(value => value.name !== undefined || value.color !== undefined ||
    value.sortOrder !== undefined || value.conversationIds !== undefined ||
    (value.conversationId !== undefined && value.member !== undefined))
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Alteração inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const list = await ownList(context,body.data.id);
  if (!list) return Response.json({ error: "Lista não encontrada." }, { status: 404, headers });
  const updates: { name?: string; color?: string; sort_order?: number; updated_at?: string } = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.color !== undefined) updates.color = body.data.color;
  if (body.data.sortOrder !== undefined) updates.sort_order = body.data.sortOrder;
  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString();
    const { error } = await context.supabase.from("whatsapp_custom_lists").update(updates)
      .eq("id",list.id).eq("agency_id",context.agency.id).eq("user_id",context.user.id);
    if (error) return Response.json({ error: error.code === "23505" ? "Nome de lista duplicado." : "Falha ao atualizar a lista." }, { status: 409, headers });
  }
  if (body.data.conversationIds !== undefined) {
    const requested = body.data.conversationIds;
    if (requested.length) {
      const { data: chats, error: chatsError } = await context.supabase.from("whatsapp_conversations")
        .select("id").eq("agency_id",context.agency.id).eq("channel_key",list.channel_key).in("id",requested);
      if (chatsError || chats?.length !== requested.length)
        return Response.json({ error: "Contato inválido para esse número." }, { status: 400, headers });
    }
    const { data: current, error: currentError } = await context.supabase.from("whatsapp_custom_list_members")
      .select("conversation_id").eq("list_id",list.id).eq("agency_id",context.agency.id).eq("user_id",context.user.id);
    if (currentError) return Response.json({ error: "Não foi possível consultar os contatos." }, { status: 503, headers });
    const old = new Set((current ?? []).map(member => member.conversation_id));
    const next = new Set(requested);
    const removing = [...old].filter(item => !next.has(item));
    const adding = requested.filter(item => !old.has(item));
    if (removing.length) {
      const { error } = await context.supabase.from("whatsapp_custom_list_members").delete()
        .eq("list_id",list.id).eq("agency_id",context.agency.id).eq("user_id",context.user.id)
        .in("conversation_id",removing);
      if (error) return Response.json({ error: "Não foi possível atualizar os contatos." }, { status: 503, headers });
    }
    if (adding.length) {
      const { error } = await context.supabase.from("whatsapp_custom_list_members").insert(adding.map(conversationId => ({
        agency_id: context.agency.id, user_id: context.user.id, list_id: list.id, conversation_id: conversationId,
      })));
      if (error) return Response.json({ error: "Não foi possível adicionar todos os contatos." }, { status: 503, headers });
    }
  }
  if (body.data.conversationId && body.data.member !== undefined) {
    const chat = await context.supabase.from("whatsapp_conversations").select("id")
      .eq("id",body.data.conversationId).eq("agency_id",context.agency.id)
      .eq("channel_key",list.channel_key).maybeSingle();
    if (!chat.data) return Response.json({ error: "Conversa não pertence a esse número." }, { status: 400, headers });
    const query = context.supabase.from("whatsapp_custom_list_members");
    // Existing links stay untouched: authenticated can INSERT/DELETE, but cannot UPDATE memberships.
    const { error } = body.data.member
      ? await query.upsert({ agency_id: context.agency.id,user_id: context.user.id,
        list_id: list.id,conversation_id: chat.data.id }, { onConflict: "list_id,conversation_id", ignoreDuplicates: true })
      : await query.delete().eq("list_id",list.id).eq("conversation_id",chat.data.id)
        .eq("agency_id",context.agency.id).eq("user_id",context.user.id);
    if (error) return Response.json({ error: "Não foi possível atualizar os contatos dessa lista." }, { status: 503, headers });
  }
  return Response.json({ ok: true }, { headers });
}

export async function DELETE(request: Request) {
  const id = uuid.safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Lista inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const { error } = await context.supabase.from("whatsapp_custom_lists").delete()
    .eq("id",id.data).eq("agency_id",context.agency.id).eq("user_id",context.user.id);
  if (error) return Response.json({ error: "Não foi possível apagar a lista." }, { status: 503, headers });
  return Response.json({ ok: true }, { headers });
}
