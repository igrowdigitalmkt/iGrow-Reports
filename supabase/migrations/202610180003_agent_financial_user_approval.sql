-- Etapa 4: TODA acao IA com impacto financeiro exige aprovacao HUMANA POR ACAO.
-- Nao aplicar em producao sem permissao. Estado global do executor segue DESLIGADO.
-- Regra conservadora: neste corte TODAS as seis mutacoes Meta alteram veiculacao/gasto.
-- Apenas futuras acoes explicitamente classificadas como nao-financeiras poderao
-- seguir sem aprovacao. Acoes novas/desconhecidas DEVEM falhar fechadas.

alter table public.agent_action_jobs
  add column execution_origin text not null default 'ai'
    check (execution_origin in ('ai','manual')),
  add column requested_by uuid,
  add column approval_expires_at timestamptz,
  add column approved_at timestamptz,
  add column approved_by uuid,
  add constraint agent_jobs_manual_initiator_check
    check (execution_origin <> 'manual' or requested_by is not null),
  add constraint agent_jobs_approval_pair_check
    check ((approved_at is null) = (approved_by is null)),
  add constraint agent_jobs_requester_fk foreign key (agency_id,requested_by)
    references public.agency_users(agency_id,user_id) on delete restrict;

alter table public.agent_action_jobs drop constraint agent_action_jobs_status_check;
alter table public.agent_action_jobs add constraint agent_action_jobs_status_check
  check (status in ('proposed','awaiting_approval','authorized','queued','executing',
    'verifying','verified','rejected','expired','failed','needs_verification'));

create or replace function private.agent_job_guard()
returns trigger language plpgsql set search_path = '' as $$
declare allowed boolean; needs_approval boolean;
begin
  -- Fail closed: all current AI actions change delivery or spending.
  -- New AI actions remain financial unless reviewed and explicitly exempted.
  needs_approval := new.execution_origin = 'ai';
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' or new.approved_at is not null
      or new.approved_by is not null or new.approval_expires_at is not null then
      raise exception 'Agente: job deve comecar sem aprovacao' using errcode='23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if row(old.id,old.agency_id,old.client_id,old.ad_account_id,old.delegation_id,
      old.idempotency_key,old.action_type,old.meta_entity_id,old.daily_budget_minor,
      old.facts_collected_at,old.rationale,old.policy_version,
      old.execution_origin,old.requested_by)
      is distinct from
      row(new.id,new.agency_id,new.client_id,new.ad_account_id,new.delegation_id,
      new.idempotency_key,new.action_type,new.meta_entity_id,new.daily_budget_minor,
      new.facts_collected_at,new.rationale,new.policy_version,
      new.execution_origin,new.requested_by) then
      raise exception 'Agente: identidade, origem e proposta imutaveis' using errcode='23514';
    end if;
    if old.approval_expires_at is distinct from new.approval_expires_at
      and not (old.status = 'proposed' and new.status = 'awaiting_approval'
        and needs_approval and old.approval_expires_at is null) then
      raise exception 'Agente: prazo de aprovacao imutavel' using errcode='23514';
    end if;
    if old.approved_by is distinct from new.approved_by
      or old.approved_at is distinct from new.approved_at then
      if not (old.status = 'awaiting_approval' and new.status = 'authorized'
        and needs_approval and old.approved_at is null and new.approved_at is not null
        and old.approval_expires_at > now()
        and coalesce(auth.role(),'') = 'authenticated'
        and new.approved_by = auth.uid()
        and exists(select 1 from public.agency_users au
          where au.agency_id = new.agency_id and au.user_id = auth.uid()
          and au.role in ('owner','admin'))) then
        raise exception 'Agente: aprovacao so pelo responsavel autenticado' using errcode='23514';
      end if;
    end if;
    if old.status = new.status then
      if old.status in ('verified','failed','rejected','expired') then
        raise exception 'Agente: resultado terminal imutavel' using errcode='23514';
      end if;
    else
      allowed := case old.status
        when 'proposed' then new.status in ('awaiting_approval','authorized','rejected','expired')
        when 'awaiting_approval' then new.status in ('authorized','rejected','expired')
        when 'authorized' then new.status in ('queued','rejected','expired')
        when 'queued' then new.status in ('executing','expired','rejected')
        when 'executing' then new.status in ('verifying','needs_verification','failed')
        when 'verifying' then new.status in ('verified','needs_verification','failed')
        when 'needs_verification' then new.status in ('verifying','verified','failed')
        else false
      end;
      if not allowed then
        raise exception 'Agente: transicao invalida' using errcode='23514';
      end if;
    end if;
    if needs_approval then
      if old.status = 'proposed' and new.status = 'authorized' then
        raise exception 'Agente: IA exige aprovacao individual' using errcode='23514';
      end if;
      if new.status = 'awaiting_approval' and old.status <> 'awaiting_approval' then
        new.approval_expires_at := now() + interval '15 minutes';
      end if;
      if new.status in ('authorized','queued','executing','verifying','verified','needs_verification')
        and (new.approved_at is null or new.approved_by is null
          or new.approval_expires_at is null
          or (new.status in ('authorized','queued','executing')
            and new.approval_expires_at <= now())) then
        raise exception 'Agente: aprovacao ausente ou expirada' using errcode='23514';
      end if;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.status = 'queued' and old.status <> 'queued' then new.queued_at := now(); end if;
    if new.status = 'executing' and old.status <> 'executing' then new.started_at := now(); end if;
    if new.status = 'verified' and old.status <> 'verified' then new.verified_at := now(); end if;
    if new.status in ('verified','rejected','expired','failed') and old.status <> new.status then
      new.finished_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- Fingerprint cobre a proposta IMUTAVEL, atrelando o clique do usuario
-- exatamente ao alvo, conta e valores mostrados na interface.
create function private.agent_approval_fingerprint(p_job public.agent_action_jobs)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws(chr(31),
    p_job.id::text, p_job.agency_id::text, p_job.client_id::text,
    p_job.ad_account_id::text, p_job.action_type, p_job.meta_entity_id,
    coalesce(p_job.daily_budget_minor::text,'none'), p_job.rationale
  ), 'UTF8')),'hex');
$$;

-- RPC autenticada; nunca service_role, IA ou browser com origem forjada.
-- Todo clique humano aprova/rejeita APENAS um job, com digest do conteudo exibido.
create function public.agent_decide_financial_action(
  p_agency_id uuid, p_job_id uuid, p_expected_fingerprint text, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.agent_action_jobs; v_user uuid;
begin
  v_user := auth.uid();
  if coalesce(auth.role(),'') <> 'authenticated' or v_user is null
    or not exists(select 1 from public.agency_users au
      where au.agency_id = p_agency_id and au.user_id = v_user
      and au.role in ('owner','admin')) then
    raise exception 'Aprovacao requer proprietario/administrador autenticado' using errcode='42501';
  end if;
  select * into j from public.agent_action_jobs
    where agency_id=p_agency_id and id=p_job_id for update;
  if not found or j.execution_origin <> 'ai' or j.status <> 'awaiting_approval'
    or j.approval_expires_at <= now() then
    raise exception 'Solicitacao ausente, encerrada ou vencida' using errcode='23514';
  end if;
  if p_expected_fingerprint is null
    or p_expected_fingerprint <> private.agent_approval_fingerprint(j) then
    raise exception 'A proposta mudou; confira novamente' using errcode='23514';
  end if;
  if p_approve is true then
    update public.agent_action_jobs set status='authorized',
      approved_by=v_user, approved_at=now()
      where agency_id=p_agency_id and id=p_job_id;
    -- A fila bloqueia concorrencia financeira dentro da mesma conta;
    -- conflito aborta a transacao inteira e NAO cria autorizacao parcial.
    update public.agent_action_jobs set status='queued'
      where agency_id=p_agency_id and id=p_job_id;
    return 'queued';
  else
    update public.agent_action_jobs set status='rejected', failure_code='user_rejected'
      where agency_id=p_agency_id and id=p_job_id;
    return 'rejected';
  end if;
end;
$$;
revoke all on function public.agent_decide_financial_action(uuid,uuid,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.agent_decide_financial_action(uuid,uuid,text,boolean)
  to authenticated;

comment on function public.agent_decide_financial_action(uuid,uuid,text,boolean) is
 'Somente owner/admin autenticado confirma por job financeiro da IA, em janela curta.';
