-- Reactions belong to the original WhatsApp message, never to the conversation timeline.
-- Message FK prevents dangling reaction rows after QR 7-day pruning or relinking.
create table public.whatsapp_message_reactions (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  message_id uuid not null references public.whatsapp_messages(id) on delete cascade,
  reactor_id text not null check (char_length(reactor_id) between 1 and 120),
  emoji text check (char_length(emoji) between 1 and 32),
  event_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (message_id, reactor_id)
);
create index whatsapp_message_reactions_agency_idx on public.whatsapp_message_reactions(agency_id, message_id);
alter table public.whatsapp_message_reactions enable row level security;
revoke all on public.whatsapp_message_reactions from public,anon,authenticated;
grant select on public.whatsapp_message_reactions to authenticated;
grant all on public.whatsapp_message_reactions to service_role;
create policy whatsapp_message_reactions_read on public.whatsapp_message_reactions
  for select to authenticated using (private.can_open_whatsapp(agency_id));

-- Only service role may apply authenticated webhook or confirmed outbound reactions.
-- The target must exist in the same agency AND the exact chat/number. Duplicate,
-- delayed and out-of-order updates never resurrect an older emoji.
create function public.record_whatsapp_message_reaction(
  p_agency_id uuid, p_connection_id uuid, p_remote_id text,
  p_target_external_id text, p_reactor_id text, p_emoji text, p_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Sem permissao.' using errcode='42501'; end if;
  if char_length(p_target_external_id) not between 1 and 200
    or char_length(p_reactor_id) not between 1 and 120
    or (p_emoji <> '' and (p_emoji is null or char_length(p_emoji) > 32))
    or p_at is null then return false; end if;
  select m.id into v_id
  from public.whatsapp_messages m
  join public.whatsapp_conversations c on c.id=m.conversation_id
  where m.agency_id=p_agency_id and c.agency_id=p_agency_id
    and c.channel_key=coalesce(p_connection_id::text,'qr')
    and c.remote_id=p_remote_id and m.external_id=p_target_external_id limit 1;
  if v_id is null then return false; end if;
  insert into public.whatsapp_message_reactions(agency_id,message_id,reactor_id,emoji,event_at)
  values(p_agency_id,v_id,p_reactor_id,nullif(p_emoji,''),p_at)
  on conflict(message_id,reactor_id) do update set
    emoji=excluded.emoji,event_at=excluded.event_at,updated_at=now()
  where public.whatsapp_message_reactions.event_at <= excluded.event_at;
  return true;
end $$;
revoke all on function public.record_whatsapp_message_reaction(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_whatsapp_message_reaction(uuid,uuid,text,text,text,text,timestamptz) to service_role;
