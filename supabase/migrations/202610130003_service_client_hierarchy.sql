-- Leitura da hierarquia (campanhas, conjuntos e anúncios) pelo servidor, sem usuário logado, para a análise de IA
-- das mensagens agendadas citar anúncios. Mesmo caminho autorizado de service_client_analytics: executa como dono
-- da organização e restaura o usuário no fim. Só a chave de serviço executa.
create function public.service_client_hierarchy(p_client_id uuid, p_date_from date, p_date_to date)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_owner uuid; v_previous text := current_setting('request.jwt.claim.sub', true); v_accounts uuid[]; v_rows jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select au.user_id into v_owner
  from public.clients c join public.agency_users au on au.agency_id = c.agency_id
  where c.id = p_client_id and c.archived_at is null and au.role = 'owner'
  order by au.created_at, au.user_id limit 1;
  if v_owner is null then return null; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    select array_agg(id::uuid) into v_accounts
    from jsonb_array_elements_text(public.get_client_analytics(p_client_id, p_date_from, p_date_to, null)->'selectedAccountIds') id;
    v_rows := public.get_client_analytics_hierarchy(p_client_id, p_date_from, p_date_to, v_accounts);
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_previous, ''), true);
  return v_rows;
end $$;
revoke all on function public.service_client_hierarchy(uuid, date, date) from public, anon, authenticated;
grant execute on function public.service_client_hierarchy(uuid, date, date) to service_role;
