-- Etapa 2.2F: toda organização NOVA nasce sob o controle comercial, nunca "sem plano" (que equivale a recursos ilimitados).
-- Antes, uma organização criada sem o plano de teste configurado, com falha na ativação do teste ou por quem já usou o teste (segunda
-- organização) ficava sem plano e, portanto, com tudo liberado. Agora, na MESMA transação da criação:
--  1) teste gratuito de 7 dias (uma vez por pessoa), se o plano do teste estiver configurado e a ativação funcionar;
--  2) caso contrário, acesso RESTRITO (leitura; operações pagas bloqueadas) até contratar um plano;
--  3) sem nenhum plano publicado no catálogo, a criação é recusada (nunca se cria organização ilimitada).
-- Organizações já existentes não são tocadas (a função só atua em organização sem plano e sem assinatura, recém-criada).
-- Incremental: só substitui public.create_own_agency (mesmo contrato) e cria uma função privada. Não apaga nem altera dados.

create function private.billing_init_new_workspace(p_agency uuid, p_user uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare s private.billing_settings; v_plan uuid; v_reason text := 'trial_not_configured';
begin
  if exists (select 1 from private.agency_plan_assignments where agency_id = p_agency)
     or exists (select 1 from private.billing_subscriptions where agency_id = p_agency) then
    return 'skipped';
  end if;
  select * into s from private.billing_settings;
  if s.trial_plan_version_id is not null then
    if exists (select 1 from private.billing_trials where started_by = p_user) then
      v_reason := 'trial_already_used';
    else
      begin
        perform public.billing_start_trial(p_agency, p_user);
        return 'trial';
      exception when others then
        v_reason := 'trial_failed';
      end;
    end if;
  end if;
  v_plan := coalesce(s.trial_plan_version_id, (select v.id from private.plan_versions v where v.status = 'published' order by v.published_at desc nulls last limit 1));
  if v_plan is null then
    raise exception 'Cadastro indisponível: o catálogo comercial ainda não foi configurado.' using errcode = '55000';
  end if;
  -- Acesso restrito: todos os limites em 0 e recursos pagos desligados; a pessoa lê, acessa a assinatura e pode contratar.
  insert into private.agency_plan_assignments(agency_id, plan_version_id, kind, access_state, assigned_by)
    values (p_agency, v_plan, 'trial', 'restricted', p_user);
  perform private.billing_audit('system', p_user, p_agency, null, 'trial.not_granted', jsonb_build_object('reason', v_reason));
  return 'restricted';
end $$;
revoke all on function private.billing_init_new_workspace(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.create_own_agency(p_name text, p_timezone text default 'America/Sao_Paulo')
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
  perform private.billing_init_new_workspace(v_agency, v_user);
  return v_agency;
end $$;
revoke all on function public.create_own_agency(text, text) from public, anon;
grant execute on function public.create_own_agency(text, text) to authenticated;
