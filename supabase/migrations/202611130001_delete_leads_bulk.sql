-- Excluir vários leads de uma vez (até 200 por pedido). Aditiva: só uma função, chamável apenas pelo servidor.
-- Mesmo efeito de `delete_lead`: apaga notas e histórico, solta os avisos já enviados e marca os leads de formulário da Meta para não voltarem.

create or replace function public.delete_leads(p_client_id uuid, p_lead_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer := 0;
begin
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 or cardinality(p_lead_ids) > 200 then
    raise exception 'Informe de 1 a 200 leads.' using errcode = '22023';
  end if;
  select array_agg(l.id) into v_ids
  from public.leads l join public.lead_pages p on p.id = l.lead_page_id
  where l.id = any (p_lead_ids) and p.client_id = p_client_id;
  if v_ids is null then return 0; end if;
  update public.lead_alert_deliveries set lead_id = null where lead_id = any (v_ids);
  delete from public.lead_events where lead_id = any (v_ids);
  insert into public.lead_tombstones (lead_page_id, leadgen_id)
    select l.lead_page_id, l.leadgen_id from public.leads l where l.id = any (v_ids) and l.channel = 'form'
    on conflict do nothing;
  with removed as (delete from public.leads where id = any (v_ids) returning 1)
    select count(*) into v_count from removed;
  return v_count;
end;
$$;

revoke all on function public.delete_leads(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_leads(uuid, uuid[]) to service_role;
