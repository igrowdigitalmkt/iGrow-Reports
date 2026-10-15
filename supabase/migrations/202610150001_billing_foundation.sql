-- Fundação financeira (etapa 2.2A): assinaturas por cartão de crédito com o Asaas. Sem Pix, sem boleto, sem cobrança manual.
-- Princípios:
--  * Nada daqui cria planos, assinaturas, testes ou cobranças: a migration só adiciona estruturas e uma linha de configuração.
--    Organizações existentes continuam sem plano (sem restrição comercial).
--  * A fonte de verdade do dinheiro é o Asaas. O iGrow guarda um espelho mínimo e decide os DIREITOS DE USO. Os eventos do
--    Asaas só chegam aqui depois de o servidor conferir o pagamento/assinatura na API do Asaas (snapshot verificado).
--  * Uma organização nunca tem duas assinaturas vivas, nem duas contratações em andamento (travas + índices únicos).
--  * Só as funções abaixo (service_role) mudam o estado financeiro. Nem a organização nem o Super Admin confirmam pagamento.
--  * Concessão administrativa (kind 'administrative'), teste gratuito (kind 'trial') e assinatura paga (kind 'subscription')
--    são coisas diferentes e nunca se convertem sozinhas.
-- Tudo no schema private, sem privilégios de tabela para a API.

-- ---------------------------------------------------------------------------------------------------
-- 1. Plano da organização: novo tipo "trial" e estado de acesso (restrição por teste vencido ou suspensão)
-- ---------------------------------------------------------------------------------------------------
alter table private.agency_plan_assignments drop constraint agency_plan_assignments_kind_check;
alter table private.agency_plan_assignments add constraint agency_plan_assignments_kind_check
  check (kind in ('administrative', 'subscription', 'trial'));
-- 'restricted' = acesso de leitura preservado, novas operações pagas bloqueadas (limites 0 e funcionalidades desligadas).
alter table private.agency_plan_assignments add column access_state text not null default 'full'
  check (access_state in ('full', 'restricted'));

-- Uma concessão administrativa feita pelo Super Admin nunca herda a restrição de um teste vencido ou de uma suspensão.
create function private.assignment_normalize()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'administrative' then new.access_state := 'full'; end if;
  return new;
end $$;
create trigger assignment_normalize before insert or update on private.agency_plan_assignments
  for each row execute function private.assignment_normalize();

-- Mesma regra de precedência da etapa 2.1; só acrescenta o acesso restrito (depois do interruptor global).
create or replace function private.resolve_entitlement(p_agency uuid, p_key text)
returns private.entitlement_result language plpgsql stable security definer set search_path = '' as $$
declare
  d private.entitlement_definitions; ov private.entitlement_overrides; pe private.plan_version_entitlements;
  asg private.agency_plan_assignments; r private.entitlement_result;
begin
  select * into d from private.entitlement_definitions where key = p_key;
  if not found then raise exception 'Recurso desconhecido: %.', p_key using errcode = '22023'; end if;
  select * into asg from private.agency_plan_assignments a where a.agency_id = p_agency;
  r.managed := found;
  r.kind := d.kind; r.enabled := false; r.limit_value := null; r.unlimited := false;
  if d.kind = 'feature' and not d.globally_enabled then r.source := 'global'; return r; end if;
  if not r.managed then
    r.source := 'unmanaged';
    if d.kind = 'feature' then r.enabled := true; else r.unlimited := true; end if;
    return r;
  end if;
  -- Teste vencido ou assinatura suspensa/encerrada: os dados continuam visíveis, mas nada novo é criado.
  if asg.access_state = 'restricted' then
    r.source := 'billing_restricted';
    if d.kind = 'limit' then r.limit_value := 0; end if;
    return r;
  end if;
  select * into ov from private.entitlement_overrides o
  where o.agency_id = p_agency and o.key = p_key and o.revoked_at is null and o.starts_at <= now()
    and (o.expires_at is null or o.expires_at > now())
  order by o.created_at desc limit 1;
  if found then
    r.source := 'override';
    if d.kind = 'feature' then r.enabled := coalesce(ov.enabled, false);
    else r.unlimited := ov.unlimited; r.limit_value := ov.limit_value; end if;
  else
    select e.* into pe from private.plan_version_entitlements e
    where e.plan_version_id = asg.plan_version_id and e.key = p_key;
    if found then
      r.source := 'plan';
      if d.kind = 'feature' then r.enabled := pe.enabled; else r.unlimited := pe.unlimited; r.limit_value := pe.limit_value; end if;
    else
      r.source := 'plan_not_included';
    end if;
  end if;
  if d.kind = 'limit' and not r.unlimited and r.limit_value is null then r.limit_value := 0; end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Regras comerciais (padrões aprovados; administráveis depois pelo Super Admin)
-- ---------------------------------------------------------------------------------------------------
create table private.billing_settings (
  id boolean primary key default true check (id),
  trial_days integer not null default 7 check (trial_days between 1 and 90),
  -- Plano (versão) que define os limites do teste gratuito; criado pelo Super Admin. Sem ele o teste não pode começar.
  trial_plan_version_id uuid references private.plan_versions(id) on delete restrict,
  past_due_grace_days integer not null default 7 check (past_due_grace_days between 0 and 60),
  -- O Asaas aceita checkouts de 10 a 1440 minutos.
  checkout_minutes integer not null default 30 check (checkout_minutes between 10 and 1440),
  -- Upgrade pode ser imediato (etapa futura); downgrade só vale no próximo ciclo.
  downgrade_timing text not null default 'next_cycle' check (downgrade_timing = 'next_cycle'),
  -- Trava de segurança: enquanto falso, nada de produção do Asaas é aceito pelo banco.
  live_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.billing_settings default values;

-- ---------------------------------------------------------------------------------------------------
-- 3. Cliente financeiro (organização ↔ cliente no Asaas). Nenhum dado pessoal é guardado aqui.
-- ---------------------------------------------------------------------------------------------------
create table private.billing_customers (
  agency_id uuid not null references public.agencies(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'production')),
  asaas_customer_id text not null check (asaas_customer_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  created_at timestamptz not null default now(),
  primary key (agency_id, environment),
  unique (environment, asaas_customer_id),
  unique (agency_id, environment, asaas_customer_id)
);

-- ---------------------------------------------------------------------------------------------------
-- 4. Intenções de contratação. O id é o identificador interno único; no máximo UMA em andamento por organização.
-- ---------------------------------------------------------------------------------------------------
create table private.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  environment text not null check (environment in ('sandbox', 'production')),
  plan_version_id uuid not null references private.plan_versions(id) on delete restrict,
  cycle text not null check (cycle in ('monthly', 'yearly')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  payment_method text not null default 'credit_card' check (payment_method = 'credit_card'),
  request_key text not null check (char_length(request_key) between 8 and 80),
  -- creating: gravada ANTES de qualquer envio ao Asaas (se o processo morrer aqui, nada foi enviado e ela é liberada em 3 minutos).
  -- dispatching: o pedido de checkout está sendo enviado (pode já existir no Asaas). unknown: sem resposta (o checkout pode existir);
  -- nos dois casos a organização fica protegida de uma segunda criação só até o checkout vencer (prazo conhecido, enviado por nós).
  status text not null default 'creating' check (status in ('creating', 'dispatching', 'awaiting_payment', 'unknown', 'completed', 'expired', 'canceled', 'failed')),
  asaas_checkout_id text check (asaas_checkout_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  checkout_url text check (char_length(checkout_url) <= 600),
  subscription_id uuid,
  last_error text check (char_length(last_error) <= 300),
  dispatched_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (agency_id, request_key)
);
create unique index billing_one_open_intent_per_agency on private.billing_checkout_intents(agency_id)
  where status in ('creating', 'dispatching', 'awaiting_payment', 'unknown');
create index billing_intents_open_expiry_idx on private.billing_checkout_intents(expires_at)
  where status in ('creating', 'dispatching', 'awaiting_payment', 'unknown');

-- ---------------------------------------------------------------------------------------------------
-- 5. Assinaturas financeiras (versão EXATA do plano contratado, com o valor gravado na contratação)
-- ---------------------------------------------------------------------------------------------------
create table private.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  environment text not null check (environment in ('sandbox', 'production')),
  plan_version_id uuid not null references private.plan_versions(id) on delete restrict,
  cycle text not null check (cycle in ('monthly', 'yearly')),
  amount_cents integer not null check (amount_cents > 0),
  asaas_subscription_id text not null check (asaas_subscription_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  asaas_customer_id text not null,
  intent_id uuid references private.billing_checkout_intents(id) on delete restrict,
  -- pending: criada, primeira cobrança ainda não confirmada · active · past_due: renovação falhou, dentro da tolerância ·
  -- suspended: tolerância esgotada · canceled: encerrada (reativar = nova assinatura).
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'suspended', 'canceled')),
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_due_date date,
  -- Vencimento da cobrança em atraso mais antiga e fim da tolerância (vencimento + dias de tolerância, fim do dia em Brasília).
  overdue_due_date date,
  grace_ends_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_at_period_end boolean not null default false,
  -- O cancelamento no Asaas é uma chamada externa depois do commit; fica pendente até ser confirmada (e é repetível).
  remote_cancel_pending boolean not null default false,
  canceled_at timestamptz,
  -- Alterações agendadas para o próximo ciclo (downgrade). Preparado, ainda não usado.
  scheduled_plan_version_id uuid references private.plan_versions(id) on delete restrict,
  scheduled_cycle text check (scheduled_cycle in ('monthly', 'yearly')),
  -- Situações que exigem decisão humana (valor divergente, estorno, assinatura removida no Asaas). Nunca bloqueia sozinha.
  attention_reason text check (char_length(attention_reason) <= 300),
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, asaas_subscription_id),
  foreign key (agency_id, environment, asaas_customer_id) references private.billing_customers(agency_id, environment, asaas_customer_id),
  check (status <> 'active' or current_period_end is not null),
  check ((scheduled_plan_version_id is null) = (scheduled_cycle is null))
);
-- No máximo UMA assinatura viva por organização (qualquer ambiente).
create unique index billing_one_live_subscription_per_agency on private.billing_subscriptions(agency_id) where status <> 'canceled';
create index billing_subscriptions_status_idx on private.billing_subscriptions(status, grace_ends_at);
alter table private.billing_checkout_intents add constraint billing_intents_subscription_fkey
  foreign key (subscription_id) references private.billing_subscriptions(id) on delete restrict;

-- Transições permitidas (defesa em profundidade: as funções já seguem estas regras) e identidade imutável.
create function private.billing_subscription_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.agency_id <> old.agency_id or new.environment <> old.environment or new.asaas_subscription_id <> old.asaas_subscription_id
     or new.asaas_customer_id <> old.asaas_customer_id or new.plan_version_id <> old.plan_version_id or new.cycle <> old.cycle
     or new.amount_cents <> old.amount_cents then
    raise exception 'Identidade e condições contratadas da assinatura são imutáveis.' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('active', 'canceled'))
    or (old.status = 'active' and new.status in ('past_due', 'suspended', 'canceled'))
    or (old.status = 'past_due' and new.status in ('active', 'suspended', 'canceled'))
    or (old.status = 'suspended' and new.status in ('active', 'canceled'))) then
    raise exception 'Transição de estado inválida: % para %.', old.status, new.status using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger billing_subscription_guard before update on private.billing_subscriptions
  for each row execute function private.billing_subscription_guard();
create function private.billing_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros financeiros não são apagados.' using errcode = '42501';
end $$;
create trigger billing_subscription_no_delete before delete on private.billing_subscriptions
  for each row execute function private.billing_no_delete();

-- ---------------------------------------------------------------------------------------------------
-- 6. Pagamentos (espelho mínimo) e teste gratuito
-- ---------------------------------------------------------------------------------------------------
create table private.billing_payments (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox', 'production')),
  asaas_payment_id text not null check (asaas_payment_id ~ '^[A-Za-z0-9_-]{4,80}$'),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  subscription_id uuid not null references private.billing_subscriptions(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  status text not null check (status in ('PENDING', 'AWAITING_RISK_ANALYSIS', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'OVERDUE',
    'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL',
    'DUNNING_REQUESTED', 'DUNNING_RECEIVED', 'OTHER')),
  billing_type text not null check (char_length(billing_type) <= 40),
  confirmed_at timestamptz,
  invoice_url text check (char_length(invoice_url) <= 600),
  -- Quando o servidor leu este pagamento na API do Asaas: um retrato mais antigo nunca sobrescreve um mais novo.
  observed_at timestamptz not null,
  last_event_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, asaas_payment_id)
);
create index billing_payments_subscription_idx on private.billing_payments(subscription_id, due_date desc);
create trigger billing_payment_no_delete before delete on private.billing_payments
  for each row execute function private.billing_no_delete();

-- Teste gratuito: um por organização e um por usuário que o iniciou (freia a criação de várias organizações para repetir o teste).
create table private.billing_trials (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references public.agencies(id) on delete restrict,
  started_by uuid not null unique references auth.users(id) on delete restrict,
  plan_version_id uuid not null references private.plan_versions(id) on delete restrict,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'superseded')),
  check (ends_at > started_at)
);
create trigger billing_trial_no_delete before delete on private.billing_trials
  for each row execute function private.billing_no_delete();

-- ---------------------------------------------------------------------------------------------------
-- 7. Eventos recebidos do Asaas (caixa de entrada durável) e auditoria financeira (somente acrescenta)
-- ---------------------------------------------------------------------------------------------------
create table private.billing_events (
  id bigint generated always as identity primary key,
  environment text not null check (environment in ('sandbox', 'production')),
  asaas_event_id text not null check (char_length(asaas_event_id) between 4 and 120),
  event_type text not null check (char_length(event_type) between 2 and 80),
  resource_type text not null check (resource_type in ('payment', 'subscription', 'checkout', 'other')),
  resource_id text check (char_length(resource_id) <= 120),
  -- Só os campos úteis do evento (sem nome, e-mail ou documento do cliente); o servidor filtra antes de gravar.
  payload jsonb not null check (octet_length(payload::text) <= 20000),
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed', 'needs_review')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 300),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (environment, asaas_event_id)
);
create index billing_events_pending_idx on private.billing_events(next_attempt_at) where status in ('received', 'failed', 'processing');

create table private.billing_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('system', 'user', 'operator')),
  actor_id uuid,
  agency_id uuid,
  subscription_id uuid,
  action text not null check (char_length(action) between 3 and 80),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 8000)
);
create index billing_audit_agency_idx on private.billing_audit_log(agency_id, at desc);
create function private.billing_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'A auditoria financeira só aceita novos registros.' using errcode = '42501';
end $$;
create trigger billing_audit_immutable before update or delete on private.billing_audit_log
  for each row execute function private.billing_audit_immutable();

alter table private.billing_settings enable row level security;
alter table private.billing_customers enable row level security;
alter table private.billing_checkout_intents enable row level security;
alter table private.billing_subscriptions enable row level security;
alter table private.billing_payments enable row level security;
alter table private.billing_trials enable row level security;
alter table private.billing_events enable row level security;
alter table private.billing_audit_log enable row level security;
revoke all on private.billing_settings, private.billing_customers, private.billing_checkout_intents, private.billing_subscriptions,
  private.billing_payments, private.billing_trials, private.billing_events, private.billing_audit_log from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 8. Funções internas
-- ---------------------------------------------------------------------------------------------------
create function private.billing_lock_agency(p_agency uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('billing:' || p_agency::text, 0));
$$;

create function private.billing_audit(p_actor_type text, p_actor uuid, p_agency uuid, p_subscription uuid, p_action text, p_meta jsonb default '{}'::jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into private.billing_audit_log(actor_type, actor_id, agency_id, subscription_id, action, metadata)
  values (p_actor_type, p_actor, p_agency, p_subscription, p_action, coalesce(p_meta, '{}'::jsonb));
$$;

create function private.billing_is_owner(p_agency uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_users au where au.agency_id = p_agency and au.user_id = p_user and au.role = 'owner');
$$;

create function private.billing_intent_json(i private.billing_checkout_intents)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('intent_id', i.id, 'status', i.status, 'environment', i.environment, 'plan_version_id', i.plan_version_id,
    'cycle', i.cycle, 'amount_cents', i.amount_cents, 'asaas_checkout_id', i.asaas_checkout_id, 'checkout_url', i.checkout_url, 'expires_at', i.expires_at);
$$;

-- Direitos de uso da organização a partir do estado financeiro. É a ÚNICA ponte entre dinheiro e direitos:
--  assinatura ativa/em atraso (dentro da tolerância) → plano contratado, acesso total
--  assinatura suspensa ou encerrada → mesmo plano, acesso restrito (dados preservados)
--  sem assinatura viva: teste vencido → restrito (só quando o plano atual ainda é o do teste)
-- Nunca devolve uma organização gerenciada ao estado "sem plano" (isso liberaria tudo de graça).
create function private.billing_sync_access(p_agency uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare sub private.billing_subscriptions; asg private.agency_plan_assignments; v_trial private.billing_trials;
begin
  select * into sub from private.billing_subscriptions where agency_id = p_agency and status <> 'canceled';
  select * into asg from private.agency_plan_assignments where agency_id = p_agency;
  if sub.id is not null then
    if sub.status in ('active', 'past_due', 'suspended') then
      if found and asg.kind = 'administrative' then
        -- A concessão GRATUITA DE PLANO é substituída; concessões especiais de recursos/limites (entitlement_overrides) seguem valendo.
        perform private.billing_audit('system', null, p_agency, sub.id, 'access.concession_replaced',
          jsonb_build_object('previous_plan_version_id', asg.plan_version_id, 'overrides_preserved',
            (select count(*) from private.entitlement_overrides o where o.agency_id = p_agency and o.revoked_at is null and (o.expires_at is null or o.expires_at > now()))));
      end if;
      insert into private.agency_plan_assignments(agency_id, plan_version_id, kind, access_state)
      values (p_agency, sub.plan_version_id, 'subscription', case when sub.status = 'suspended' then 'restricted' else 'full' end)
      on conflict (agency_id) do update set plan_version_id = excluded.plan_version_id, kind = 'subscription',
        access_state = excluded.access_state, note = null, assigned_by = null,
        assigned_at = case when private.agency_plan_assignments.kind = 'subscription'
                            and private.agency_plan_assignments.plan_version_id = excluded.plan_version_id
                           then private.agency_plan_assignments.assigned_at else now() end;
      update private.billing_trials set status = 'superseded' where agency_id = p_agency and status = 'active';
    end if;
    return;
  end if;
  -- Sem assinatura viva.
  if asg.agency_id is not null and asg.kind = 'subscription' and asg.access_state = 'full' then
    update private.agency_plan_assignments set access_state = 'restricted' where agency_id = p_agency;
  elsif asg.agency_id is not null and asg.kind = 'trial' and asg.access_state = 'full' then
    select * into v_trial from private.billing_trials where agency_id = p_agency;
    if v_trial.id is not null and v_trial.ends_at <= now() then
      update private.agency_plan_assignments set access_state = 'restricted' where agency_id = p_agency;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 9. Contratação (somente servidor). Chamada ANTES de falar com o Asaas: grava a intenção e impede duplicidade.
-- ---------------------------------------------------------------------------------------------------
create function public.billing_get_customer(p_agency_id uuid, p_environment text)
returns text language sql stable security definer set search_path = '' as $$
  select asaas_customer_id from private.billing_customers where agency_id = p_agency_id and environment = p_environment;
$$;

create function public.billing_set_customer(p_agency_id uuid, p_environment text, p_asaas_customer_id text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_live boolean; v_id text;
begin
  select live_enabled into v_live from private.billing_settings;
  if p_environment = 'production' and not v_live then raise exception 'Cobrança em produção ainda não está liberada.' using errcode = '42501'; end if;
  insert into private.billing_customers(agency_id, environment, asaas_customer_id) values (p_agency_id, p_environment, p_asaas_customer_id)
  on conflict (agency_id, environment) do nothing;
  select asaas_customer_id into v_id from private.billing_customers where agency_id = p_agency_id and environment = p_environment;
  return v_id;
end $$;

create function public.billing_create_intent(p_agency_id uuid, p_user_id uuid, p_plan_version_id uuid, p_cycle text, p_request_key text, p_environment text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s private.billing_settings; i private.billing_checkout_intents; pv record; v_amount integer;
begin
  if p_cycle not in ('monthly', 'yearly') then raise exception 'Ciclo de cobrança inválido.' using errcode = '22023'; end if;
  if p_environment not in ('sandbox', 'production') then raise exception 'Ambiente inválido.' using errcode = '22023'; end if;
  if char_length(coalesce(p_request_key, '')) not between 8 and 80 then raise exception 'Chave de idempotência inválida.' using errcode = '22023'; end if;
  select * into s from private.billing_settings;
  if p_environment = 'production' and not s.live_enabled then raise exception 'Cobrança em produção ainda não está liberada.' using errcode = '42501'; end if;
  if not private.billing_is_owner(p_agency_id, p_user_id) then raise exception 'Somente o proprietário da organização pode contratar.' using errcode = '42501'; end if;

  perform private.billing_lock_agency(p_agency_id);
  update private.billing_checkout_intents set status = 'expired', updated_at = now()
    where agency_id = p_agency_id and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') and expires_at < now();
  -- Nunca enviada ao Asaas (o processo morreu antes): liberada com segurança, sem risco de cobrança duplicada.
  update private.billing_checkout_intents set status = 'failed', last_error = 'Abandonada antes do envio ao Asaas.', updated_at = now()
    where agency_id = p_agency_id and status = 'creating' and dispatched_at is null and created_at < now() - interval '3 minutes';

  -- Reenvio da mesma solicitação (clique duplo, nova tentativa): devolve a mesma intenção.
  select * into i from private.billing_checkout_intents where agency_id = p_agency_id and request_key = p_request_key;
  if found then
    if i.plan_version_id <> p_plan_version_id or i.cycle <> p_cycle then
      raise exception 'Esta chave de solicitação já foi usada com outros dados.' using errcode = '22023';
    end if;
    return jsonb_build_object('reused', true, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i);
  end if;
  if exists (select 1 from private.billing_subscriptions where agency_id = p_agency_id and status <> 'canceled') then
    raise exception 'A organização já possui uma assinatura. Regularize ou cancele a atual antes de contratar outra.' using errcode = '23505';
  end if;
  -- Outra aba, outro clique ou checkout em andamento (inclusive com resultado desconhecido): reaproveita, nunca cria um segundo.
  select * into i from private.billing_checkout_intents where agency_id = p_agency_id and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown');
  if found then return jsonb_build_object('reused', true, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i); end if;

  -- Preço sempre do servidor: versão publicada e atual de um plano à venda, com preço válido para o ciclo.
  select pv2.id, pv2.status, pv2.price_monthly_cents, pv2.price_yearly_cents, p.current_version_id, p.sellable into pv
    from private.plan_versions pv2 join private.plans p on p.id = pv2.plan_id where pv2.id = p_plan_version_id;
  if pv.id is null or pv.status <> 'published' or pv.current_version_id <> pv.id or not pv.sellable then
    raise exception 'Este plano não está disponível para contratação.' using errcode = '22023';
  end if;
  v_amount := case p_cycle when 'monthly' then pv.price_monthly_cents else pv.price_yearly_cents end;
  if v_amount is null or v_amount <= 0 then raise exception 'O plano não tem preço para este ciclo.' using errcode = '22023'; end if;

  insert into private.billing_checkout_intents(agency_id, requested_by, environment, plan_version_id, cycle, amount_cents, request_key, expires_at)
  values (p_agency_id, p_user_id, p_environment, p_plan_version_id, p_cycle, v_amount, p_request_key, now() + make_interval(mins => s.checkout_minutes + 15))
  returning * into i;
  perform private.billing_audit('user', p_user_id, p_agency_id, null, 'intent.created', jsonb_build_object('intent_id', i.id, 'cycle', p_cycle, 'amount_cents', v_amount));
  return jsonb_build_object('reused', false, 'checkout_minutes', s.checkout_minutes) || private.billing_intent_json(i);
end $$;

-- creating → dispatching (ANTES de enviar ao Asaas) | failed ; dispatching → awaiting_payment (checkout criado) | unknown (timeout:
-- pode existir no Asaas) | failed (recusa definitiva). Ao despachar, o prazo da intenção passa a ser o do checkout enviado + 2 minutos.
create function public.billing_mark_intent(p_intent_id uuid, p_status text, p_checkout_id text default null, p_checkout_url text default null, p_error text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare i private.billing_checkout_intents; s private.billing_settings;
begin
  select * into i from private.billing_checkout_intents where id = p_intent_id for update;
  if not found then raise exception 'Intenção não encontrada.' using errcode = '22023'; end if;
  if i.status = p_status then return private.billing_intent_json(i); end if;
  if not ((i.status = 'creating' and p_status in ('dispatching', 'failed')) or (i.status = 'dispatching' and p_status in ('awaiting_payment', 'unknown', 'failed'))) then
    raise exception 'Transição de intenção inválida: % para %.', i.status, p_status using errcode = '22023';
  end if;
  if p_status = 'awaiting_payment' and p_checkout_id is null then raise exception 'Informe o checkout criado.' using errcode = '22023'; end if;
  select * into s from private.billing_settings;
  update private.billing_checkout_intents set status = p_status, asaas_checkout_id = coalesce(p_checkout_id, asaas_checkout_id),
    checkout_url = coalesce(p_checkout_url, checkout_url), last_error = left(p_error, 300), updated_at = now(),
    dispatched_at = case when p_status = 'dispatching' then now() else dispatched_at end,
    expires_at = case when p_status = 'dispatching' then now() + make_interval(mins => s.checkout_minutes + 2) else expires_at end
  where id = p_intent_id returning * into i;
  perform private.billing_audit('system', null, i.agency_id, null, 'intent.' || p_status, jsonb_build_object('intent_id', i.id));
  return private.billing_intent_json(i);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Teste gratuito (fundação; nada a chama ainda: o cadastro público não muda nesta etapa)
-- ---------------------------------------------------------------------------------------------------
create function public.billing_start_trial(p_agency_id uuid, p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s private.billing_settings; v_ends timestamptz;
begin
  select * into s from private.billing_settings;
  if s.trial_plan_version_id is null then raise exception 'O plano do teste gratuito ainda não foi configurado.' using errcode = '22023'; end if;
  if not private.billing_is_owner(p_agency_id, p_user_id) then raise exception 'Somente o proprietário da organização inicia o teste.' using errcode = '42501'; end if;
  perform private.billing_lock_agency(p_agency_id);
  if exists (select 1 from private.agency_plan_assignments where agency_id = p_agency_id)
     or exists (select 1 from private.billing_subscriptions where agency_id = p_agency_id) then
    raise exception 'A organização já possui plano; o teste gratuito não se aplica.' using errcode = '22023';
  end if;
  if exists (select 1 from private.billing_trials where agency_id = p_agency_id or started_by = p_user_id) then
    raise exception 'O teste gratuito já foi utilizado.' using errcode = '23505';
  end if;
  v_ends := now() + make_interval(days => s.trial_days);
  insert into private.billing_trials(agency_id, started_by, plan_version_id, ends_at) values (p_agency_id, p_user_id, s.trial_plan_version_id, v_ends);
  insert into private.agency_plan_assignments(agency_id, plan_version_id, kind, assigned_by, access_state)
    values (p_agency_id, s.trial_plan_version_id, 'trial', p_user_id, 'full');
  perform private.billing_audit('user', p_user_id, p_agency_id, null, 'trial.started', jsonb_build_object('ends_at', v_ends));
  return jsonb_build_object('ends_at', v_ends);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 11. Caixa de entrada de eventos do Asaas
-- ---------------------------------------------------------------------------------------------------
create function public.billing_record_event(p_environment text, p_event_id text, p_event_type text, p_resource_type text, p_resource_id text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into private.billing_events(environment, asaas_event_id, event_type, resource_type, resource_id, payload)
  values (p_environment, p_event_id, p_event_type, p_resource_type, p_resource_id, p_payload)
  on conflict (environment, asaas_event_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from private.billing_events where environment = p_environment and asaas_event_id = p_event_id;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- Reserva eventos para processamento (com validade da reserva: se o processo morrer, outro retoma).
create function public.billing_claim_events(p_limit integer default 10, p_lease_seconds integer default 120, p_event_id bigint default null)
returns jsonb language sql volatile security definer set search_path = '' as $$
  with picked as (
    select e.id from private.billing_events e
    where (p_event_id is null or e.id = p_event_id) and e.attempts < 8
      and ((e.status in ('received', 'failed') and e.next_attempt_at <= now()) or (e.status = 'processing' and e.locked_until < now()))
    order by e.id limit greatest(1, least(coalesce(p_limit, 10), 50)) for update skip locked
  ), claimed as (
    update private.billing_events e set status = 'processing', attempts = e.attempts + 1, updated_at = now(),
      locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)))
    from picked where e.id = picked.id
    returning e.id, e.environment, e.asaas_event_id, e.event_type, e.resource_type, e.resource_id, e.payload, e.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.id), '[]'::jsonb) from claimed;
$$;

create function public.billing_finish_event(p_id bigint, p_outcome text, p_detail text default null, p_retry_seconds integer default 60)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare e private.billing_events;
begin
  if p_outcome not in ('processed', 'ignored', 'needs_review', 'retry') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
  select * into e from private.billing_events where id = p_id for update;
  if not found then raise exception 'Evento não encontrado.' using errcode = '22023'; end if;
  if e.status in ('processed', 'ignored', 'needs_review') then return; end if;
  if p_outcome = 'retry' then
    if e.attempts >= 8 then
      update private.billing_events set status = 'needs_review', last_error = left(coalesce(p_detail, 'Tentativas esgotadas.'), 300), locked_until = null, updated_at = now() where id = p_id;
    else
      update private.billing_events set status = 'failed', last_error = left(p_detail, 300), locked_until = null, updated_at = now(),
        next_attempt_at = now() + make_interval(secs => least(21600, greatest(1, coalesce(p_retry_seconds, 60)) * power(2, greatest(e.attempts - 1, 0))::integer))
      where id = p_id;
    end if;
    return;
  end if;
  update private.billing_events set status = p_outcome, last_error = left(p_detail, 300), locked_until = null, processed_at = now(), updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 12. Aplicação de fatos VERIFICADOS (o servidor leu o objeto na API do Asaas; o corpo do webhook nunca basta)
-- ---------------------------------------------------------------------------------------------------
-- Snapshot da assinatura: {id, customer, value, cycle, status, billingType, deleted}
create function public.billing_apply_subscription(p_environment text, p_snapshot jsonb, p_event_id bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id text := p_snapshot ->> 'id'; v_customer text := p_snapshot ->> 'customer'; v_value numeric := nullif(p_snapshot ->> 'value', '')::numeric;
  v_cycle text; v_amount integer; v_inactive boolean; v_agency uuid; sub private.billing_subscriptions; i private.billing_checkout_intents;
begin
  v_cycle := case upper(coalesce(p_snapshot ->> 'cycle', '')) when 'MONTHLY' then 'monthly' when 'YEARLY' then 'yearly' else null end;
  v_amount := case when v_value is null then null else round(v_value * 100)::integer end;
  v_inactive := coalesce((p_snapshot ->> 'deleted')::boolean, false) or upper(coalesce(p_snapshot ->> 'status', 'ACTIVE')) in ('INACTIVE', 'EXPIRED');

  select agency_id into v_agency from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_id;
  if v_agency is not null then
    perform private.billing_lock_agency(v_agency);
    select * into sub from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_id for update;
    if v_customer is not null and v_customer <> sub.asaas_customer_id then
      update private.billing_subscriptions set attention_reason = 'Cliente da assinatura no Asaas diverge do registrado.' where id = sub.id;
      return 'mismatch';
    end if;
    if sub.status = 'canceled' then return 'already_canceled'; end if;
    if v_inactive then
      if sub.status = 'pending' then
        update private.billing_subscriptions set status = 'canceled', canceled_at = now() where id = sub.id;
        perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.canceled_before_activation', jsonb_build_object('event_id', p_event_id));
        perform private.billing_sync_access(sub.agency_id);
        return 'canceled_before_activation';
      end if;
      if sub.cancel_at_period_end then return 'cancel_already_recorded'; end if;
      -- Encerrada no Asaas sem pedido feito no iGrow: o período já pago é preservado e a renovação cessa.
      update private.billing_subscriptions set cancel_at_period_end = true,
        attention_reason = 'Assinatura encerrada no Asaas sem pedido no iGrow; acesso mantido até o fim do período pago.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.ended_at_gateway', jsonb_build_object('event_id', p_event_id));
      return 'cancel_recorded';
    end if;
    if v_amount is not null and v_amount <> sub.amount_cents then
      update private.billing_subscriptions set attention_reason = 'Valor da assinatura no Asaas diverge do contratado.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.value_mismatch', jsonb_build_object('expected', sub.amount_cents, 'received', v_amount));
      return 'mismatch';
    end if;
    return 'noop';
  end if;

  -- Assinatura nova: precisa pertencer a um cliente NOSSO e casar com a contratação em andamento.
  select agency_id into v_agency from private.billing_customers where environment = p_environment and asaas_customer_id = v_customer;
  if v_agency is null then return 'unattributed'; end if;
  perform private.billing_lock_agency(v_agency);
  if v_inactive then return 'ignored_inactive'; end if;
  if exists (select 1 from private.billing_subscriptions where agency_id = v_agency and status <> 'canceled') then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.duplicate_detected', jsonb_build_object('asaas_subscription_id', v_id, 'event_id', p_event_id));
    return 'duplicate_subscription';
  end if;
  select * into i from private.billing_checkout_intents where agency_id = v_agency and environment = p_environment
    and status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') order by created_at desc limit 1 for update;
  if not found then return 'no_intent'; end if;
  if v_cycle is distinct from i.cycle or v_amount is distinct from i.amount_cents or upper(coalesce(p_snapshot ->> 'billingType', '')) <> 'CREDIT_CARD' then
    perform private.billing_audit('system', null, v_agency, null, 'subscription.mismatch', jsonb_build_object('asaas_subscription_id', v_id, 'intent_id', i.id));
    return 'mismatch';
  end if;
  insert into private.billing_subscriptions(agency_id, environment, plan_version_id, cycle, amount_cents, asaas_subscription_id, asaas_customer_id, intent_id)
  values (v_agency, p_environment, i.plan_version_id, i.cycle, i.amount_cents, v_id, v_customer, i.id) returning * into sub;
  update private.billing_checkout_intents set status = 'completed', subscription_id = sub.id, completed_at = now(), updated_at = now() where id = i.id;
  perform private.billing_audit('system', null, v_agency, sub.id, 'subscription.created', jsonb_build_object('intent_id', i.id, 'cycle', i.cycle, 'amount_cents', i.amount_cents));
  return 'created';
end $$;

-- Snapshot do pagamento: {id, subscription, customer, value, dueDate, status, billingType, confirmedDate, invoiceUrl, observedAt}
-- p_signal = 'capture_refused' quando o evento foi PAYMENT_CREDIT_CARD_CAPTURE_REFUSED.
create function public.billing_apply_payment(p_environment text, p_snapshot jsonb, p_event_id bigint default null, p_signal text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  s private.billing_settings; sub private.billing_subscriptions; pay private.billing_payments;
  v_sub_ext text := p_snapshot ->> 'subscription'; v_id text := p_snapshot ->> 'id'; v_agency uuid;
  v_status text := upper(coalesce(p_snapshot ->> 'status', 'OTHER')); v_type text := upper(coalesce(p_snapshot ->> 'billingType', ''));
  v_amount integer := round((p_snapshot ->> 'value')::numeric * 100)::integer; v_due date := (p_snapshot ->> 'dueDate')::date;
  v_observed timestamptz := coalesce((p_snapshot ->> 'observedAt')::timestamptz, now());
  v_cand_end timestamptz; v_new_end timestamptz; v_prev text; v_grace timestamptz; v_confirmed timestamptz;
begin
  if v_sub_ext is null then return 'ignored_no_subscription'; end if;
  select agency_id into v_agency from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_sub_ext;
  if v_agency is null then return 'unknown_subscription'; end if;
  perform private.billing_lock_agency(v_agency);
  select * into sub from private.billing_subscriptions where environment = p_environment and asaas_subscription_id = v_sub_ext for update;
  select * into s from private.billing_settings;
  if p_snapshot ->> 'customer' is distinct from sub.asaas_customer_id then
    update private.billing_subscriptions set attention_reason = 'Pagamento de outro cliente vinculado a esta assinatura.' where id = sub.id;
    return 'mismatch';
  end if;
  if v_status not in ('PENDING', 'AWAITING_RISK_ANALYSIS', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'OVERDUE', 'REFUNDED', 'REFUND_REQUESTED',
      'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED') then
    v_status := 'OTHER';
  end if;
  v_confirmed := nullif(coalesce(p_snapshot ->> 'confirmedDate', p_snapshot ->> 'paymentDate'), '')::timestamptz;

  -- Retrato mais antigo que o já gravado: ignorado (eventos fora de ordem não desfazem o que é mais novo).
  select * into pay from private.billing_payments where environment = p_environment and asaas_payment_id = v_id;
  if found and pay.observed_at > v_observed then return 'stale_snapshot'; end if;
  insert into private.billing_payments(environment, asaas_payment_id, agency_id, subscription_id, amount_cents, due_date, status, billing_type, confirmed_at, invoice_url, observed_at, last_event_id)
  values (p_environment, v_id, sub.agency_id, sub.id, v_amount, v_due, v_status, v_type, case when v_status in ('CONFIRMED', 'RECEIVED') then coalesce(v_confirmed, v_observed) end,
          left(p_snapshot ->> 'invoiceUrl', 600), v_observed, p_event_id)
  on conflict (environment, asaas_payment_id) do update set status = excluded.status, billing_type = excluded.billing_type, amount_cents = excluded.amount_cents,
    due_date = excluded.due_date, invoice_url = coalesce(excluded.invoice_url, private.billing_payments.invoice_url),
    confirmed_at = coalesce(private.billing_payments.confirmed_at, excluded.confirmed_at), observed_at = excluded.observed_at,
    last_event_id = excluded.last_event_id, updated_at = now();

  if v_amount <> sub.amount_cents then
    update private.billing_subscriptions set attention_reason = 'Valor do pagamento diverge do contratado.' where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.value_mismatch', jsonb_build_object('payment', v_id, 'expected', sub.amount_cents, 'received', v_amount));
    return 'mismatch';
  end if;

  if v_status in ('CONFIRMED', 'RECEIVED') then
    -- Só cartão de crédito libera acesso (pagamento "recebido em dinheiro" registrado à mão no Asaas nunca ativa nada).
    if v_type <> 'CREDIT_CARD' then
      update private.billing_subscriptions set attention_reason = 'Pagamento confirmado sem ser por cartão de crédito.' where id = sub.id;
      return 'mismatch';
    end if;
    if sub.status = 'canceled' then
      update private.billing_subscriptions set attention_reason = 'Pagamento confirmado em assinatura já cancelada: revisar estorno.' where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.after_cancel', jsonb_build_object('payment', v_id));
      return 'payment_for_canceled';
    end if;
    -- Período pago: do vencimento ao próximo ciclo. Nunca encolhe (eventos repetidos ou antigos não mudam nada).
    v_cand_end := (v_due::timestamp at time zone 'America/Sao_Paulo') + case sub.cycle when 'monthly' then interval '1 month' else interval '1 year' end;
    v_new_end := greatest(coalesce(sub.current_period_end, v_cand_end), v_cand_end);
    -- Cobrança antiga já superada por um atraso mais antigo ainda em aberto não reativa a assinatura.
    if sub.status in ('past_due', 'suspended') and sub.overdue_due_date is not null and v_due < sub.overdue_due_date then
      return 'recorded_only';
    end if;
    if sub.status = 'suspended' and v_new_end <= now() then
      update private.billing_subscriptions set attention_reason = 'Pagamento de cobrança antiga não cobre o período atual; aguardar a próxima cobrança.' where id = sub.id;
      return 'stale_payment';
    end if;
    if sub.status = 'active' and v_new_end = sub.current_period_end then return 'noop_duplicate'; end if;
    v_prev := sub.status;
    update private.billing_subscriptions set status = 'active', started_at = coalesce(started_at, now()),
      current_period_start = case when sub.current_period_start is null or v_new_end > sub.current_period_end then (v_due::timestamp at time zone 'America/Sao_Paulo') else sub.current_period_start end,
      current_period_end = v_new_end, next_due_date = (v_new_end at time zone 'America/Sao_Paulo')::date,
      grace_ends_at = null, overdue_due_date = null where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id,
      case v_prev when 'pending' then 'subscription.activated' when 'active' then 'payment.renewed' else 'subscription.reactivated' end,
      jsonb_build_object('payment', v_id, 'period_end', v_new_end, 'event_id', p_event_id));
    perform private.billing_sync_access(sub.agency_id);
    return 'activated';
  end if;

  if v_status = 'OVERDUE' or p_signal = 'capture_refused' then
    if sub.status = 'pending' then
      if v_status = 'OVERDUE' then
        update private.billing_subscriptions set status = 'canceled', canceled_at = now(), remote_cancel_pending = true where id = sub.id;
        perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.activation_failed', jsonb_build_object('payment', v_id));
        perform private.billing_sync_access(sub.agency_id);
        return 'activation_failed';
      end if;
      return 'recorded_only';
    end if;
    if sub.status in ('active', 'past_due') and (sub.overdue_due_date is null or v_due < sub.overdue_due_date) then
      -- Tolerância: vencimento + dias configurados, até o fim desse dia em Brasília.
      v_grace := ((v_due + s.past_due_grace_days + 1)::timestamp at time zone 'America/Sao_Paulo');
      update private.billing_subscriptions set status = 'past_due', overdue_due_date = v_due, grace_ends_at = v_grace where id = sub.id;
      perform private.billing_audit('system', null, sub.agency_id, sub.id, 'subscription.past_due', jsonb_build_object('payment', v_id, 'grace_ends_at', v_grace));
      return 'past_due';
    end if;
    return 'recorded_only';
  end if;

  if v_status in ('REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then
    -- Dinheiro devolvido ou contestado: pede decisão humana; o acesso não muda sozinho (evita bloqueio ou liberação indevidos).
    update private.billing_subscriptions set attention_reason = 'Estorno ou contestação em ' || v_id || ': revisar.' where id = sub.id;
    perform private.billing_audit('system', null, sub.agency_id, sub.id, 'payment.' || lower(v_status), jsonb_build_object('payment', v_id));
    return 'needs_review';
  end if;
  return 'recorded_only';
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 13. Cancelamento (o período já pago é preservado; o Asaas só é avisado depois do commit)
-- ---------------------------------------------------------------------------------------------------
create function public.billing_request_cancel(p_agency_id uuid, p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare sub private.billing_subscriptions;
begin
  if not private.billing_is_owner(p_agency_id, p_user_id) then raise exception 'Somente o proprietário da organização cancela a assinatura.' using errcode = '42501'; end if;
  perform private.billing_lock_agency(p_agency_id);
  select * into sub from private.billing_subscriptions where agency_id = p_agency_id and status <> 'canceled' for update;
  if not found then raise exception 'Não há assinatura para cancelar.' using errcode = '22023'; end if;
  if sub.cancel_requested_at is null then
    if sub.status = 'pending' then
      update private.billing_subscriptions set status = 'canceled', canceled_at = now(), cancel_requested_at = now(), cancel_at_period_end = true, remote_cancel_pending = true where id = sub.id;
    else
      update private.billing_subscriptions set cancel_requested_at = now(), cancel_at_period_end = true, remote_cancel_pending = true where id = sub.id;
    end if;
    perform private.billing_audit('user', p_user_id, p_agency_id, sub.id, 'subscription.cancel_requested', jsonb_build_object('period_end', sub.current_period_end));
    perform private.billing_sync_access(p_agency_id);
  end if;
  select * into sub from private.billing_subscriptions where id = sub.id;
  return jsonb_build_object('subscription_id', sub.id, 'environment', sub.environment, 'asaas_subscription_id', sub.asaas_subscription_id,
    'effective_at', sub.current_period_end, 'remote_cancel_pending', sub.remote_cancel_pending, 'status', sub.status);
end $$;

create function public.billing_confirm_remote_cancel(p_subscription_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update private.billing_subscriptions set remote_cancel_pending = false where id = p_subscription_id;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 14. Manutenção periódica (idempotente): prazos que vencem sem que chegue nenhum evento
-- ---------------------------------------------------------------------------------------------------
create function public.billing_run_maintenance()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r record; v_intents integer; v_canceled integer := 0; v_suspended integer := 0; v_trials integer := 0; v_stuck integer;
begin
  update private.billing_checkout_intents set status = 'expired', updated_at = now()
    where status in ('creating', 'dispatching', 'awaiting_payment', 'unknown') and expires_at < now();
  get diagnostics v_intents = row_count;
  update private.billing_checkout_intents set status = 'failed', last_error = 'Abandonada antes do envio ao Asaas.', updated_at = now()
    where status = 'creating' and dispatched_at is null and created_at < now() - interval '3 minutes';

  -- Cancelamento pedido (ou assinatura encerrada no Asaas): vale até o fim do período já pago.
  for r in update private.billing_subscriptions set status = 'canceled', canceled_at = now()
    where status in ('active', 'past_due', 'suspended') and cancel_at_period_end and current_period_end <= now()
    returning id, agency_id loop
    perform private.billing_audit('system', null, r.agency_id, r.id, 'subscription.canceled', '{}'::jsonb);
    perform private.billing_sync_access(r.agency_id);
    v_canceled := v_canceled + 1;
  end loop;

  -- Tolerância esgotada: suspende (acesso restrito, nada é apagado).
  for r in update private.billing_subscriptions set status = 'suspended'
    where status = 'past_due' and grace_ends_at <= now() returning id, agency_id loop
    perform private.billing_audit('system', null, r.agency_id, r.id, 'subscription.suspended', '{}'::jsonb);
    perform private.billing_sync_access(r.agency_id);
    v_suspended := v_suspended + 1;
  end loop;

  -- Teste gratuito vencido sem assinatura: restringe (nunca vira cobrança sozinho).
  for r in update private.billing_trials set status = 'expired' where status = 'active' and ends_at <= now() returning agency_id loop
    perform private.billing_audit('system', null, r.agency_id, null, 'trial.expired', '{}'::jsonb);
    perform private.billing_sync_access(r.agency_id);
    v_trials := v_trials + 1;
  end loop;

  -- Eventos cujo processamento morreu repetidamente: vão para revisão humana.
  update private.billing_events set status = 'needs_review', last_error = 'Processamento interrompido repetidamente.', locked_until = null, updated_at = now()
    where status = 'processing' and locked_until < now() and attempts >= 8;
  get diagnostics v_stuck = row_count;
  return jsonb_build_object('intents_expired', v_intents, 'subscriptions_canceled', v_canceled, 'subscriptions_suspended', v_suspended,
    'trials_expired', v_trials, 'events_needing_review', v_stuck);
end $$;

-- Trabalho para a reconciliação com o Asaas (o servidor consulta a API e reaplica os fatos): assinaturas a conferir e
-- cancelamentos que ainda não chegaram ao Asaas.
create function public.billing_reconcile_work(p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reconcile', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'environment', x.environment, 'asaas_subscription_id', x.asaas_subscription_id) order by x.last_reconciled_at nulls first)
      from (select id, environment, asaas_subscription_id, last_reconciled_at from private.billing_subscriptions
            where status in ('pending', 'active', 'past_due', 'suspended') and (last_reconciled_at is null or last_reconciled_at < now() - interval '1 day')
            order by last_reconciled_at nulls first limit greatest(1, least(coalesce(p_limit, 20), 100))) x), '[]'::jsonb),
    'remote_cancel', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'environment', c.environment, 'asaas_subscription_id', c.asaas_subscription_id))
      from (select id, environment, asaas_subscription_id from private.billing_subscriptions where remote_cancel_pending limit 50) c), '[]'::jsonb),
    -- Contratações com resultado desconhecido: o servidor consulta no Asaas se já existe assinatura do cliente.
    'intents', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'environment', n.environment, 'asaas_customer_id', n.asaas_customer_id))
      from (select i.id, i.environment, bc.asaas_customer_id from private.billing_checkout_intents i
            join private.billing_customers bc on bc.agency_id = i.agency_id and bc.environment = i.environment
            where i.status in ('dispatching', 'unknown') order by i.created_at limit 25) n), '[]'::jsonb));
$$;

create function public.billing_mark_reconciled(p_subscription_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update private.billing_subscriptions set last_reconciled_at = now() where id = p_subscription_id;
$$;

-- Usada no MOMENTO DA EXECUÇÃO (automações, envios): acesso restrito = teste vencido, assinatura suspensa ou encerrada.
-- Organização sem plano ou com plano/concessão em dia retorna falso (comportamento atual preservado).
create function public.agency_billing_restricted(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select a.access_state = 'restricted' from private.agency_plan_assignments a where a.agency_id = p_agency_id), false);
$$;

-- Mesma função da etapa 2.1, com um campo a mais para a mensagem correta quando o motivo é a restrição financeira.
create or replace function public.agency_ai_entitlement(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f private.entitlement_result; b private.entitlement_result;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operação não autorizada.' using errcode = '42501'; end if;
  f := private.resolve_entitlement(p_agency_id, 'ai_assistant');
  b := private.resolve_entitlement(p_agency_id, 'ai_budget_usd_cents');
  return jsonb_build_object('allowed', f.enabled, 'restricted', f.source = 'billing_restricted',
    'budget_usd', case when b.managed and not b.unlimited then coalesce(b.limit_value, 0) / 100.0 end);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 15. Leituras (somente leitura): a organização vê a própria situação; o Super Admin consulta
-- ---------------------------------------------------------------------------------------------------
create function public.get_agency_billing(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.has_agency_role(p_agency_id, array['owner', 'admin']::public.agency_role[]) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscription', (select jsonb_build_object('status', s.status, 'cycle', s.cycle, 'amount_cents', s.amount_cents, 'plan_version_id', s.plan_version_id,
        'current_period_end', s.current_period_end, 'next_due_date', s.next_due_date, 'grace_ends_at', s.grace_ends_at,
        'cancel_at_period_end', s.cancel_at_period_end, 'cancel_requested_at', s.cancel_requested_at)
      from private.billing_subscriptions s where s.agency_id = p_agency_id and s.status <> 'canceled'),
    'trial', (select jsonb_build_object('status', t.status, 'ends_at', t.ends_at) from private.billing_trials t where t.agency_id = p_agency_id),
    'pending_checkout', (select jsonb_build_object('status', i.status, 'cycle', i.cycle, 'amount_cents', i.amount_cents, 'expires_at', i.expires_at,
        'verifying', i.status in ('dispatching', 'unknown'), 'retry_after', i.expires_at)
      from private.billing_checkout_intents i where i.agency_id = p_agency_id and i.status in ('creating', 'dispatching', 'awaiting_payment', 'unknown')),
    'access', (select a.access_state from private.agency_plan_assignments a where a.agency_id = p_agency_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('due_date', p.due_date, 'amount_cents', p.amount_cents, 'status', p.status, 'confirmed_at', p.confirmed_at, 'invoice_url', p.invoice_url) order by p.due_date desc)
      from (select * from private.billing_payments where agency_id = p_agency_id order by due_date desc limit 12) p), '[]'::jsonb))
  into v;
  return v;
end $$;

create function public.platform_billing_overview(p_agency_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return jsonb_build_object(
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('agency_id', s.agency_id, 'agency_name', a.name, 'status', s.status, 'cycle', s.cycle,
        'amount_cents', s.amount_cents, 'environment', s.environment, 'current_period_end', s.current_period_end, 'grace_ends_at', s.grace_ends_at,
        'cancel_at_period_end', s.cancel_at_period_end, 'attention_reason', s.attention_reason, 'remote_cancel_pending', s.remote_cancel_pending) order by s.created_at desc)
      from private.billing_subscriptions s join public.agencies a on a.id = s.agency_id where p_agency_id is null or s.agency_id = p_agency_id), '[]'::jsonb),
    'events_needing_review', (select count(*) from private.billing_events where status = 'needs_review'),
    'events_pending', (select count(*) from private.billing_events where status in ('received', 'failed', 'processing')),
    'oldest_pending_event_at', (select min(received_at) from private.billing_events where status in ('received', 'failed', 'processing')));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 16. Permissões de execução
-- ---------------------------------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
    and p.proname = any(array['assignment_normalize', 'billing_subscription_guard', 'billing_no_delete', 'billing_audit_immutable', 'billing_lock_agency',
      'billing_audit', 'billing_is_owner', 'billing_intent_json', 'billing_sync_access']) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- Só o servidor (service_role) muda o estado financeiro.
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname = any(array['billing_get_customer', 'billing_set_customer', 'billing_create_intent', 'billing_mark_intent', 'billing_start_trial',
      'billing_record_event', 'billing_claim_events', 'billing_finish_event', 'billing_apply_subscription', 'billing_apply_payment',
      'billing_request_cancel', 'billing_confirm_remote_cancel', 'billing_run_maintenance', 'billing_reconcile_work', 'billing_mark_reconciled', 'agency_billing_restricted']) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname = any(array['get_agency_billing', 'platform_billing_overview']) loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
