-- Novas acoes MANUAIS do executor Meta: renomear campanha, conjunto e anuncio; pausar e retomar anuncio.
-- ADITIVA: preserva as seis acoes anteriores, todos os registros, indices, RLS, permissoes e o ledger.
-- Estas acoes so existem para origem 'manual': a IA continua limitada as seis acoes anteriores (constraint abaixo, no banco).
-- Nao remove nem altera dados; a unica coluna nova e opcional (`new_name`) e as linhas existentes continuam validas.

alter table public.agent_action_jobs add column if not exists new_name text;

-- Lista de acoes: as seis anteriores + as cinco novas (nenhum outro tipo).
alter table public.agent_action_jobs drop constraint agent_action_jobs_action_type_check;
alter table public.agent_action_jobs add constraint agent_action_jobs_action_type_check check (action_type in (
  'pause_campaign','resume_campaign','pause_adset','resume_adset','set_campaign_daily_budget','set_adset_daily_budget',
  'rename_campaign','rename_adset','rename_ad','pause_ad','resume_ad'));

-- A IA NAO pode usar as acoes novas: exigem origem manual. Garantido pelo banco, nao so pelo codigo.
alter table public.agent_action_jobs add constraint agent_jobs_manual_only_actions_check check (
  execution_origin = 'manual' or action_type in (
    'pause_campaign','resume_campaign','pause_adset','resume_adset','set_campaign_daily_budget','set_adset_daily_budget'));

-- Novo nome: obrigatorio exatamente nas acoes de renomear; sem espacos nas pontas e com comprimento controlado.
alter table public.agent_action_jobs add constraint agent_jobs_new_name_check check (
  (action_type like 'rename\_%') = (new_name is not null)
  and (new_name is null or (new_name = btrim(new_name) and char_length(new_name) between 1 and 400)));

-- Guarda do ledger (definicao vigente) com `new_name` tambem imutavel: o que foi pedido nao muda depois de registrado.
create or replace function private.agent_job_guard()
returns trigger language plpgsql set search_path = '' as $$
declare allowed boolean; needs_approval boolean;
begin
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
      old.execution_origin,old.requested_by,old.new_name)
      is distinct from
      row(new.id,new.agency_id,new.client_id,new.ad_account_id,new.delegation_id,
      new.idempotency_key,new.action_type,new.meta_entity_id,new.daily_budget_minor,
      new.facts_collected_at,new.rationale,new.policy_version,
      new.execution_origin,new.requested_by,new.new_name) then
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

-- Sonda de prontidao (so service_role): o servidor so oferece as novas operacoes quando o banco as aceita DE FATO
-- (coluna e restricao presentes). Sem esta funcao ou com o banco desatualizado, a interface mantem as operacoes desabilitadas.
create or replace function public.agent_manual_extended_actions_supported()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao reservada ao servico' using errcode = '42501';
  end if;
  return exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'agent_action_jobs' and column_name = 'new_name')
    and coalesce((select bool_and(position('rename_campaign' in pg_get_constraintdef(c.oid)) > 0 and position('resume_ad' in pg_get_constraintdef(c.oid)) > 0)
      from pg_constraint c where c.conrelid = 'public.agent_action_jobs'::regclass and c.conname = 'agent_action_jobs_action_type_check'), false);
end;
$$;
revoke all on function public.agent_manual_extended_actions_supported() from public, anon, authenticated;
grant execute on function public.agent_manual_extended_actions_supported() to service_role;

comment on column public.agent_action_jobs.new_name is
  'Novo nome pedido (somente acoes manuais rename_*). Imutavel depois de registrado; a confirmacao vem da leitura posterior na Meta.';
