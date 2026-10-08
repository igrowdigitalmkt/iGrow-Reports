-- Keep @lid conversation snapshots so unread flags are preserved even if CHATS_SET
-- arrives before MESSAGES_SET. Phone-number and LID identifiers may coexist;
-- message-less rows stay hidden by the seven-day recent-inbox filter.

create or replace function public.sync_whatsapp_qr_chat_states(p_agency_id uuid, p_states jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_states, '[]'::jsonb)) <> 'array' then return 0; end if;

  -- Preserve @lid unread snapshots during initial sync (the QR inbox only
  -- displays rows when a recent message exists).
  with states as (
    select distinct on (x.remote_id)
      nullif(left(btrim(x.remote_id), 120), '') as remote_id,
      nullif(left(btrim(coalesce(x.title, '')), 200), '') as title,
      x.archived,
      case when x.unread_count is null then null else greatest(0, least(x.unread_count, 100000)) end as unread_count
    from jsonb_to_recordset(coalesce(p_states, '[]'::jsonb))
      as x(remote_id text, title text, archived boolean, unread_count integer)
    where nullif(btrim(x.remote_id), '') is not null
  )
  insert into public.whatsapp_conversations(
    agency_id, channel, whatsapp_connection_id, channel_key, remote_id, is_group,
    title, archived, unread_count
  )
  select
    p_agency_id, 'qr', null, 'qr', s.remote_id, s.remote_id like '%@g.us',
    s.title, coalesce(s.archived, false), coalesce(s.unread_count, 0)
  from states s
  where char_length(s.remote_id) between 3 and 120
  on conflict (agency_id, channel_key, remote_id) do nothing;
  get diagnostics v_inserted = row_count;

  with states as (
    select distinct on (x.remote_id)
      nullif(left(btrim(x.remote_id), 120), '') as remote_id,
      nullif(left(btrim(coalesce(x.title, '')), 200), '') as title,
      x.archived,
      case when x.unread_count is null then null else greatest(0, least(x.unread_count, 100000)) end as unread_count
    from jsonb_to_recordset(coalesce(p_states, '[]'::jsonb))
      as x(remote_id text, title text, archived boolean, unread_count integer)
    where nullif(btrim(x.remote_id), '') is not null
  )
  update public.whatsapp_conversations c set
    title = coalesce(c.title, s.title),
    archived = coalesce(s.archived, c.archived),
    unread_count = coalesce(s.unread_count, c.unread_count),
    updated_at = now()
  from states s
  where c.agency_id = p_agency_id
    and c.channel = 'qr'
    and c.channel_key = 'qr'
    and c.remote_id = s.remote_id
    and (c.title is distinct from coalesce(c.title, s.title)
      or c.archived is distinct from coalesce(s.archived, c.archived)
      or c.unread_count is distinct from coalesce(s.unread_count, c.unread_count));
  get diagnostics v_updated = row_count;

  return v_inserted + v_updated;
end $$;

revoke all on function public.sync_whatsapp_qr_chat_states(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_whatsapp_qr_chat_states(uuid, jsonb) to service_role;
