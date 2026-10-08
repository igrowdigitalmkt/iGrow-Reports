-- A QR reset is scoped to one agency. Unlike the official WhatsApp Cloud channel,
-- this session is disposable. Its prior history must NEVER be re-imported.
create table if not exists public.whatsapp_qr_reset_guards (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  fresh_after timestamptz not null default now(),
  blocked boolean not null default true
);
alter table public.whatsapp_qr_reset_guards enable row level security;
revoke all on public.whatsapp_qr_reset_guards from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_qr_reset_guards to service_role;

create or replace function public.begin_whatsapp_qr_reset(p_agency_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  insert into public.whatsapp_qr_reset_guards(agency_id, fresh_after, blocked)
    values (p_agency_id, now(), true)
    on conflict(agency_id) do update set fresh_after=excluded.fresh_after, blocked=true;
end $$;
revoke all on function public.begin_whatsapp_qr_reset(uuid) from public, anon, authenticated;
grant execute on function public.begin_whatsapp_qr_reset(uuid) to service_role;

create or replace function public.clear_whatsapp_qr_history_batch(p_agency_id uuid, p_batch_size integer default 40)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_removed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_batch_size < 1 or p_batch_size > 40 then
    raise exception 'Lote inválido.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.whatsapp_qr_reset_guards g
      where g.agency_id=p_agency_id and g.blocked) then
    raise exception 'Bloqueio obrigatório para limpeza.' using errcode = '42501';
  end if;
  with victims as (
    select id from public.whatsapp_conversations
    where agency_id=p_agency_id and channel='qr'
    order by id limit p_batch_size
    for update skip locked
  )
  delete from public.whatsapp_conversations c using victims v where c.id=v.id;
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;
revoke all on function public.clear_whatsapp_qr_history_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.clear_whatsapp_qr_history_batch(uuid, integer) to service_role;

create or replace function public.resume_whatsapp_qr_after_reset(p_agency_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update public.whatsapp_qr_reset_guards set blocked=false where agency_id=p_agency_id;
end $$;
revoke all on function public.resume_whatsapp_qr_after_reset(uuid) from public, anon, authenticated;
grant execute on function public.resume_whatsapp_qr_after_reset(uuid) to service_role;
