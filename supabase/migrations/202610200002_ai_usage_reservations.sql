-- Reserva financeira ATOMICA do consumo de IA (reutilizavel por qualquer funcionalidade de IA).
-- ARQUIVO LOCAL PARA REVISAO: NAO aplicada em nenhum banco. Nao altera dados existentes nem migrations historicas.
--
-- Ordem: depois de 202610120002 (ai_usage), 202610140004 (agency_ai_entitlement) e 202610200001 (campaign_chat).
-- O PostgreSQL e a autoridade das reservas: a decisao de reservar (orcamento fresco + idempotencia + insercao) acontece em UMA transacao,
-- serializada por organizacao com pg_advisory_xact_lock. Nada depende de memoria do servidor.
--
-- Modelo (reaproveita ai_usage; ai_month_cost e os relatorios continuam somando cost_usd de TODAS as linhas do mes):
--   reserved             reserva em andamento; cost_usd = valor reservado (estimativa conservadora)
--   ok / error / rejected_numbers   liquidada com o consumo conhecido (cost_usd = custo calculado dos tokens)
--   error com custo 0    reserva LIBERADA (recusa certa do provedor, sem consumo)
--   unknown_consumption  consumo desconhecido (timeout, erro sem uso, reserva abandonada): cost_usd continua = estimativa e
--                        needs_reconciliation = true ate uma conciliacao; nunca vira custo zero sozinho
--
-- LIMITES HONESTOS: a reserva usa uma estimativa; ela nao e um teto absoluto da cobranca do provedor. Consumidores de IA que ainda nao
-- reservam (comentario de relatorio, resumo de carteira, resumo de WhatsApp, motor de decisao) so gravam o custo DEPOIS da chamada, e
-- por isso o teto global ainda nao e rigoroso (ver docs/HOMOLOGACAO_CHAT_CAMPANHAS.md).

-- Remove TODA restricao de checagem que limita os valores de ai_usage.status (por definicao, nao pelo nome): uma restricao com outro
-- nome continuaria impedindo 'reserved' e 'unknown_consumption'. A restricao canonica abaixo sempre e recriada.
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
            where c.conrelid = 'public.ai_usage'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ '\mstatus\M.*= ANY'
  loop
    raise notice 'ai_usage: removendo restricao de estado %', r.conname;
    execute format('alter table public.ai_usage drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_status_check
  check (status in ('ok','blocked_disabled','blocked_budget','rejected_numbers','error','reserved','unknown_consumption'));

alter table public.ai_usage
  add column if not exists request_key text check (request_key is null or char_length(request_key) between 8 and 120),
  add column if not exists scope_hash text check (scope_hash is null or char_length(scope_hash) between 8 and 80),
  add column if not exists reserved_usd numeric(12,6) check (reserved_usd is null or reserved_usd >= 0),
  add column if not exists settled_at timestamptz,
  add column if not exists needs_reconciliation boolean not null default false;

-- Uma reserva sempre nasce com valor e identificador de solicitacao.
alter table public.ai_usage add constraint ai_usage_reserved_shape
  check (status <> 'reserved' or (reserved_usd is not null and request_key is not null));

-- Idempotencia distribuida: a mesma solicitacao (organizacao + funcionalidade + identificador) existe uma unica vez.
create unique index if not exists ai_usage_request_key_idx on public.ai_usage(agency_id, feature, request_key) where request_key is not null;
create index if not exists ai_usage_open_reservations_idx on public.ai_usage(agency_id, created_at) where status = 'reserved';
create index if not exists ai_usage_reconcile_idx on public.ai_usage(agency_id, created_at) where needs_reconciliation;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reserve_ai_usage: valida, serializa por organizacao, aplica idempotencia, confere o orcamento ATUAL e cria a reserva.
-- O teto NUNCA vem do navegador nem do chamador: e calculado aqui, no momento da reserva, a partir de ai_settings (organizacao) e do
-- direito comercial (agency_ai_entitlement), com a mesma regra do portao do servidor: o teto do plano nunca e ultrapassado.
-- Resultados (outcome): reserved | duplicate_in_flight | duplicate_completed | duplicate_unknown | conflict | budget | disabled | plan |
--                       restricted | invalid. Somente 'reserved' autoriza uma chamada paga.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.reserve_ai_usage(
  p_agency_id uuid, p_client_id uuid, p_user_id uuid, p_feature text, p_model text, p_request_key text, p_scope_hash text,
  p_estimated_usd numeric, p_stale_after interval default interval '15 minutes')
returns table(outcome text, usage_id uuid, month_cost_usd numeric, budget_usd numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_existing public.ai_usage%rowtype;
  v_settings public.ai_settings%rowtype;
  v_client_enabled boolean;
  v_ent jsonb; v_plan_budget numeric; v_budget numeric; v_spent numeric; v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operação não autorizada.' using errcode = '42501'; end if;
  if p_agency_id is null or p_feature is null or p_model is null or char_length(p_model) not between 1 and 80
     or p_request_key is null or char_length(p_request_key) not between 8 and 120
     or p_scope_hash is null or char_length(p_scope_hash) not between 8 and 80
     or p_estimated_usd is null or p_estimated_usd <= 0 or p_estimated_usd > 100
     or p_stale_after is null or p_stale_after < interval '1 minute' then
    return query select 'invalid'::text, null::uuid, null::numeric, null::numeric; return;
  end if;
  -- O cliente precisa pertencer a organizacao informada.
  if p_client_id is not null and not exists (select 1 from public.clients c where c.id = p_client_id and c.agency_id = p_agency_id) then
    return query select 'invalid'::text, null::uuid, null::numeric, null::numeric; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_agency_id::text, 0));

  -- Reservas abandonadas: nao viram custo zero. Mantem o valor estimado e marcam a conciliacao.
  update public.ai_usage set status = 'unknown_consumption', needs_reconciliation = true, settled_at = now()
   where agency_id = p_agency_id and status = 'reserved' and created_at < now() - p_stale_after;

  -- Idempotencia: a solicitacao repetida NUNCA cria outra reserva nem autoriza outra chamada paga.
  select * into v_existing from public.ai_usage where agency_id = p_agency_id and feature = p_feature and request_key = p_request_key;
  if found then
    -- O identificador nao pode ser reutilizado para outro usuario, cliente ou contexto autorizado.
    if v_existing.scope_hash is distinct from p_scope_hash or v_existing.user_id is distinct from p_user_id or v_existing.client_id is distinct from p_client_id then
      return query select 'conflict'::text, null::uuid, null::numeric, null::numeric; return;
    end if;
    return query select case v_existing.status when 'reserved' then 'duplicate_in_flight' when 'unknown_consumption' then 'duplicate_unknown' else 'duplicate_completed' end,
      v_existing.id, null::numeric, null::numeric;
    return;
  end if;

  -- Configuracao ATUAL (mesma transacao): plano, interruptores da organizacao e do cliente, orcamento.
  select * into v_settings from public.ai_settings where agency_id = p_agency_id;
  if p_client_id is not null then select enabled into v_client_enabled from public.ai_client_settings where client_id = p_client_id; end if;
  v_ent := public.agency_ai_entitlement(p_agency_id);
  if (v_ent ->> 'allowed')::boolean is distinct from true then
    return query select case when coalesce((v_ent ->> 'restricted')::boolean, false) then 'restricted' else 'plan' end, null::uuid, null::numeric, null::numeric; return;
  end if;
  if coalesce(v_settings.enabled, true) = false or coalesce(v_client_enabled, true) = false then
    return query select 'disabled'::text, null::uuid, null::numeric, null::numeric; return;
  end if;
  v_plan_budget := nullif(v_ent ->> 'budget_usd', '')::numeric;
  v_budget := least(coalesce(v_settings.monthly_budget_usd, v_plan_budget, 5.00), coalesce(v_plan_budget, 'Infinity'::numeric));

  -- Gasto do mes (todas as linhas, inclusive reservas pendentes e consumo desconhecido) + esta reserva.
  select coalesce(sum(u.cost_usd), 0) into v_spent from public.ai_usage u where u.agency_id = p_agency_id and u.created_at >= v_month_start;
  if v_spent + p_estimated_usd > v_budget then
    return query select 'budget'::text, null::uuid, v_spent, v_budget; return;
  end if;

  insert into public.ai_usage(agency_id, client_id, user_id, feature, model, status, cost_usd, reserved_usd, request_key, scope_hash)
  values (p_agency_id, p_client_id, p_user_id, p_feature, p_model, 'reserved', round(p_estimated_usd, 6), round(p_estimated_usd, 6), p_request_key, p_scope_hash)
  returning id into v_id;
  return query select 'reserved'::text, v_id, v_spent + round(p_estimated_usd, 6), v_budget;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- settle_ai_usage: concilia a reserva com o consumo conhecido. Idempotente: repetir nao muda nada (primeira liquidacao vale).
--   completed -> grava tokens e o custo real (status ok | error | rejected_numbers), substituindo o valor reservado
--   released  -> recusa CERTA do provedor, sem consumo: custo 0 (status error)
--   unknown   -> consumo desconhecido: mantem a estimativa e marca conciliacao (status unknown_consumption)
-- Uma reserva ja marcada unknown_consumption pode ser conciliada depois com completed/released.
-- Resultados: settled | already_settled | not_found | invalid.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.settle_ai_usage(
  p_usage_id uuid, p_agency_id uuid, p_outcome text, p_status text default null,
  p_input_tokens integer default 0, p_output_tokens integer default 0, p_cache_read_tokens integer default 0, p_cache_write_tokens integer default 0,
  p_cost_usd numeric default null, p_request_id text default null, p_verifier_passed boolean default null, p_facts_hash text default null, p_model text default null)
returns table(outcome text, cost_usd numeric, delta_usd numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.ai_usage%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operação não autorizada.' using errcode = '42501'; end if;
  if p_usage_id is null or p_agency_id is null or p_outcome not in ('completed', 'released', 'unknown') then
    return query select 'invalid'::text, null::numeric, null::numeric; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_agency_id::text, 0));
  -- A reserva precisa ser da organizacao informada (isolamento entre organizacoes).
  select * into v_row from public.ai_usage u where u.id = p_usage_id and u.agency_id = p_agency_id for update;
  if not found then return query select 'not_found'::text, null::numeric, null::numeric; return; end if;
  if v_row.status in ('ok', 'error', 'rejected_numbers') and v_row.settled_at is not null then
    return query select 'already_settled'::text, v_row.cost_usd, null::numeric; return;
  end if;
  if v_row.status = 'unknown_consumption' and p_outcome = 'unknown' then
    return query select 'already_settled'::text, v_row.cost_usd, null::numeric; return;
  end if;
  if v_row.status not in ('reserved', 'unknown_consumption') then
    return query select 'invalid'::text, null::numeric, null::numeric; return;
  end if;

  if p_outcome = 'completed' then
    if p_status not in ('ok', 'error', 'rejected_numbers') or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 1000
       or p_input_tokens < 0 or p_output_tokens < 0 or p_cache_read_tokens < 0 or p_cache_write_tokens < 0 then
      return query select 'invalid'::text, null::numeric, null::numeric; return;
    end if;
    update public.ai_usage set status = p_status, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
        cache_read_tokens = p_cache_read_tokens, cache_write_tokens = p_cache_write_tokens, cost_usd = round(p_cost_usd, 6),
        request_id = left(p_request_id, 120), verifier_passed = p_verifier_passed, facts_hash = left(p_facts_hash, 80),
        model = coalesce(left(p_model, 80), model), settled_at = now(), needs_reconciliation = false
      where id = p_usage_id;
    return query select 'settled'::text, round(p_cost_usd, 6), round(p_cost_usd, 6) - coalesce(v_row.reserved_usd, 0);
  elsif p_outcome = 'released' then
    update public.ai_usage set status = 'error', input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0, cost_usd = 0,
        settled_at = now(), needs_reconciliation = false where id = p_usage_id;
    return query select 'settled'::text, 0::numeric, 0 - coalesce(v_row.reserved_usd, 0);
  else
    update public.ai_usage set status = 'unknown_consumption', needs_reconciliation = true, settled_at = now() where id = p_usage_id;
    return query select 'settled'::text, v_row.cost_usd, 0::numeric;
  end if;
end $$;

-- Rotina de manutencao (cron futuro): converte reservas abandonadas de TODAS as organizacoes. Nao muda o valor (a estimativa continua
-- contando); apenas as marca como consumo desconhecido a conciliar, o que tambem impede que sejam executadas de novo.
create or replace function public.sweep_stale_ai_reservations(p_older_than interval default interval '15 minutes')
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operação não autorizada.' using errcode = '42501'; end if;
  if p_older_than is null or p_older_than < interval '1 minute' then raise exception 'Intervalo inválido.' using errcode = '22023'; end if;
  update public.ai_usage set status = 'unknown_consumption', needs_reconciliation = true, settled_at = now()
   where status = 'reserved' and created_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Confirmacao, em tempo de execucao, de que ESTE banco tem a estrutura de reservas completa (estados, colunas e funcoes). Sem ela,
-- ou diante de qualquer erro, o codigo trata as reservas como indisponiveis e nao faz chamadas pagas.
-- Duas camadas, sem depender do NOME de nenhuma restricao:
--   1) estrutural: existe ao menos uma restricao de estado e TODAS as que limitam ai_usage.status aceitam 'reserved' e
--      'unknown_consumption'; as cinco colunas e as duas funcoes existem;
--   2) funcional: quando ha uma organizacao, tenta inserir uma reserva e um consumo desconhecido de teste e DESFAZ tudo (subtransacao
--      revertida por excecao). Qualquer rejeicao do banco, ou qualquer erro inesperado, resulta em falso (falha segura).
-- A funcao e volatile (a sonda grava e reverte); o chamador a consulta com cache curto.
create or replace function public.ai_reservations_ready()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_structural boolean; v_agency uuid;
begin
  v_structural := coalesce((select count(*) > 0 and bool_and(position('''reserved''' in d) > 0 and position('''unknown_consumption''' in d) > 0)
                              from (select pg_get_constraintdef(c.oid) as d from pg_constraint c
                                     where c.conrelid = 'public.ai_usage'::regclass and c.contype = 'c'
                                       and pg_get_constraintdef(c.oid) ~ '\mstatus\M.*= ANY') s), false)
    and (select count(*) = 5 from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_usage'
            and column_name in ('request_key', 'scope_hash', 'reserved_usd', 'settled_at', 'needs_reconciliation'))
    and to_regprocedure('public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval)') is not null
    and to_regprocedure('public.settle_ai_usage(uuid,uuid,text,text,integer,integer,integer,integer,numeric,text,boolean,text,text)') is not null;
  if not v_structural then return false; end if;

  select id into v_agency from public.agencies limit 1;
  if v_agency is null then return true; end if; -- banco sem organizacoes: so a verificacao estrutural e possivel
  begin
    insert into public.ai_usage(agency_id, feature, model, status, cost_usd, reserved_usd, request_key, scope_hash)
    values (v_agency, 'campaign_chat', 'readiness-probe', 'reserved', 0, 0, 'probe-' || gen_random_uuid()::text, 'probe-scope-0001');
    insert into public.ai_usage(agency_id, feature, model, status, cost_usd, needs_reconciliation)
    values (v_agency, 'campaign_chat', 'readiness-probe', 'unknown_consumption', 0, true);
    raise exception 'ai_reservations_probe_rollback';
  exception when others then
    return sqlerrm = 'ai_reservations_probe_rollback';
  end;
  return false;
end $$;

revoke all on function public.reserve_ai_usage(uuid, uuid, uuid, text, text, text, text, numeric, interval) from public, anon, authenticated;
revoke all on function public.settle_ai_usage(uuid, uuid, text, text, integer, integer, integer, integer, numeric, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.sweep_stale_ai_reservations(interval) from public, anon, authenticated;
revoke all on function public.ai_reservations_ready() from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, uuid, uuid, text, text, text, text, numeric, interval) to service_role;
grant execute on function public.settle_ai_usage(uuid, uuid, text, text, integer, integer, integer, integer, numeric, text, boolean, text, text) to service_role;
grant execute on function public.sweep_stale_ai_reservations(interval) to service_role;
grant execute on function public.ai_reservations_ready() to service_role;

-- Reversao (somente se NAO houver linhas reserved/unknown_consumption/needs_reconciliation; conferir antes):
--   drop function public.ai_reservations_ready(); drop function public.sweep_stale_ai_reservations(interval);
--   drop function public.settle_ai_usage(uuid,uuid,text,text,integer,integer,integer,integer,numeric,text,boolean,text,text);
--   drop function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,numeric,interval);
--   drop index public.ai_usage_reconcile_idx, public.ai_usage_open_reservations_idx, public.ai_usage_request_key_idx;
--   alter table public.ai_usage drop constraint ai_usage_reserved_shape;
--   alter table public.ai_usage drop column request_key, drop column scope_hash, drop column reserved_usd, drop column settled_at, drop column needs_reconciliation;
--   alter table public.ai_usage drop constraint ai_usage_status_check;
--   alter table public.ai_usage add constraint ai_usage_status_check check (status in ('ok','blocked_disabled','blocked_budget','rejected_numbers','error'));
