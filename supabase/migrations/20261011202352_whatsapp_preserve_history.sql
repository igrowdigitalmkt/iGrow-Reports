-- Preserve history even if a legacy scheduler or reset tool calls these RPCs.
-- Outgoing user actions remain governed by eligibility and sent-only policies.
create or replace function public.prune_whatsapp_qr_messages(p_batch_size integer default 200)
returns integer language sql security invoker set search_path = ''
as $$ select 0; $$;
revoke all on function public.prune_whatsapp_qr_messages(integer) from public, anon, authenticated;
grant execute on function public.prune_whatsapp_qr_messages(integer) to service_role;

create or replace function public.clear_whatsapp_qr_history_batch(p_agency_id uuid, p_batch_size integer default 40)
returns integer language sql security invoker set search_path = ''
as $$ select 0; $$;
revoke all on function public.clear_whatsapp_qr_history_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.clear_whatsapp_qr_history_batch(uuid, integer) to service_role;
