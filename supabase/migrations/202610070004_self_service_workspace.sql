-- Self-service sign-up: a signed-in person without a workspace creates their own agency and
-- becomes its owner. Limited to 5 owned agencies per person to prevent abuse.
create function public.create_own_agency(p_name text, p_timezone text default 'America/Sao_Paulo')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_agency uuid; v_owned integer;
begin
  if v_user is null then raise exception 'Entre na sua conta para criar o espaço de trabalho.' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    raise exception 'Informe o nome da agência com 2 a 120 caracteres.' using errcode = '22023';
  end if;
  select count(*) into v_owned from public.agency_users where user_id = v_user and role = 'owner';
  if v_owned >= 5 then raise exception 'Limite de espaços de trabalho atingido.' using errcode = '23514'; end if;
  insert into public.agencies(name, timezone) values (btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'America/Sao_Paulo'))
    returning id into v_agency;
  insert into public.agency_users(agency_id, user_id, role) values (v_agency, v_user, 'owner');
  insert into public.audit_logs(agency_id, actor_id, action, entity_id) values (v_agency, v_user, 'agency.created', v_agency);
  return v_agency;
end $$;
revoke all on function public.create_own_agency(text, text) from public, anon;
grant execute on function public.create_own_agency(text, text) to authenticated;
