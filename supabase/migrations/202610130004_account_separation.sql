-- Contas separadas por padrão: cada agendamento escolhe se consolida os resultados das contas do cliente.
-- Falso (padrão) = um bloco por conta. Verdadeiro = tudo somado, como se fosse uma conta.
alter table public.report_automations add column consolidate_accounts boolean not null default false;

-- Mesma leitura autorizada de service_client_analytics, para uma lista de contas (uma conta por bloco).
create function public.service_client_analytics_accounts(p_client_id uuid, p_date_from date, p_date_to date, p_account_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_owner uuid; v_previous text := current_setting('request.jwt.claim.sub', true); v_payload jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select au.user_id into v_owner
  from public.clients c join public.agency_users au on au.agency_id = c.agency_id
  where c.id = p_client_id and c.archived_at is null and au.role = 'owner'
  order by au.created_at, au.user_id limit 1;
  if v_owner is null then return null; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    v_payload := public.get_client_analytics(p_client_id, p_date_from, p_date_to, p_account_ids);
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
  return v_payload;
end $$;
revoke all on function public.service_client_analytics_accounts(uuid, date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.service_client_analytics_accounts(uuid, date, date, uuid[]) to service_role;
