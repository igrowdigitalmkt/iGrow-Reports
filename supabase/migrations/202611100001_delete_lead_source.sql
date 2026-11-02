-- Excluir uma fonte de leads com todos os leads dela, de uma vez (o app exige a confirmação digitada antes de chamar).
-- Aditiva: só cria uma função, chamável apenas pelo servidor. Os avisos já enviados ficam no registro, sem o vínculo com o lead apagado.

create or replace function public.delete_lead_source(p_client_id uuid, p_source_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not exists (select 1 from public.lead_pages where id = p_source_id and client_id = p_client_id) then
    raise exception 'Fonte indisponivel.' using errcode = '22023';
  end if;
  update public.lead_alert_deliveries set lead_id = null
    where lead_id in (select id from public.leads where lead_page_id = p_source_id);
  delete from public.lead_events
    where lead_id in (select id from public.leads where lead_page_id = p_source_id);
  with removed as (delete from public.leads where lead_page_id = p_source_id returning 1)
    select count(*) into v_count from removed;
  delete from public.lead_forms where lead_page_id = p_source_id;
  delete from public.lead_pages where id = p_source_id and client_id = p_client_id;
  return v_count;
end;
$$;

revoke all on function public.delete_lead_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_lead_source(uuid, uuid) to service_role;
