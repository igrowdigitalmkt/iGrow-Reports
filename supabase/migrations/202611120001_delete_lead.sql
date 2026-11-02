-- Excluir um lead (com notas e histórico). Aditiva: uma tabela nova e uma função, só do servidor.
-- Lead de formulário da Meta apagado deixa só o id dele em `lead_tombstones` (nenhum dado pessoal), para a próxima conferência com a Meta
-- não importar o mesmo cadastro de novo. Leads de WhatsApp e Instagram não precisam disso: uma mensagem nova gera um lead novo.

create table if not exists public.lead_tombstones (
  lead_page_id uuid not null references public.lead_pages (id) on delete cascade,
  leadgen_id text not null check (char_length(leadgen_id) between 5 and 64),
  deleted_at timestamptz not null default now(),
  primary key (lead_page_id, leadgen_id)
);

alter table public.lead_tombstones enable row level security;
revoke all on public.lead_tombstones from public, anon, authenticated;
grant all on public.lead_tombstones to service_role;

create or replace function public.delete_lead(p_client_id uuid, p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page uuid;
  v_leadgen text;
  v_channel text;
begin
  select l.lead_page_id, l.leadgen_id, l.channel into v_page, v_leadgen, v_channel
  from public.leads l join public.lead_pages p on p.id = l.lead_page_id
  where l.id = p_lead_id and p.client_id = p_client_id;
  if not found then return false; end if;
  update public.lead_alert_deliveries set lead_id = null where lead_id = p_lead_id;
  delete from public.lead_events where lead_id = p_lead_id;
  delete from public.leads where id = p_lead_id;
  if v_channel = 'form' then
    insert into public.lead_tombstones (lead_page_id, leadgen_id) values (v_page, v_leadgen) on conflict do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.delete_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_lead(uuid, uuid) to service_role;
