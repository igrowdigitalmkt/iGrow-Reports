-- Catálogo comercial e direitos de utilização (etapa 2.1). Sem cobrança e sem Asaas.
-- Regras principais:
--  * Planos têm versões: uma versão publicada é imutável; mudar condições gera uma nova versão.
--  * Só organizações com um plano atribuído (agency_plan_assignments) são "gerenciadas". Organizações sem
--    atribuição seguem exatamente como hoje (sem restrição comercial). Esta migration não atribui nada.
--  * Precedência: desativação global (recursos) > concessão ativa > plano atribuído > "não incluso".
--  * Limites são aplicados por gatilhos no banco, com trava por organização para operações simultâneas.
--  * As permissões dos usuários (papéis, módulos da equipe) continuam valendo à parte: nada aqui as substitui.
-- Tudo fica no schema private, sem privilégios de tabela para a API; o acesso passa por funções que exigem
-- operador da plataforma com MFA (admin) ou membro da organização (leitura dos próprios direitos).

-- ---------------------------------------------------------------------------------------------------
-- Catálogo de recursos (só o que o código realmente aplica)
-- ---------------------------------------------------------------------------------------------------
create table private.entitlement_definitions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  kind text not null check (kind in ('feature', 'limit')),
  label text not null check (char_length(label) between 2 and 80),
  description text not null check (char_length(description) <= 300),
  unit text check (char_length(unit) <= 40),
  sort_order integer not null default 100,
  globally_enabled boolean not null default true,
  disabled_reason text check (char_length(disabled_reason) <= 300),
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete set null,
  check (kind = 'feature' or globally_enabled)
);

insert into private.entitlement_definitions(key, kind, label, description, unit, sort_order) values
  ('ai_assistant', 'feature', 'Inteligência artificial', 'Comentários, resumos e análises escritos por IA nos relatórios e mensagens.', null, 10),
  ('client_portal', 'feature', 'Portal do cliente', 'Convidar clientes finais para acompanhar os próprios resultados.', null, 20),
  ('clients', 'limit', 'Clientes ativos', 'Clientes não arquivados da organização.', 'clientes', 30),
  ('team_members', 'limit', 'Usuários da equipe', 'Membros da equipe, contando também convites pendentes.', 'usuários', 40),
  ('ad_accounts', 'limit', 'Contas de anúncio', 'Contas de anúncio (Meta e Google) vinculadas a clientes.', 'contas', 50),
  ('whatsapp_numbers', 'limit', 'Números oficiais de WhatsApp', 'Números da API oficial conectados. Conexões por QR Code não entram neste limite.', 'números', 60),
  ('report_automations', 'limit', 'Automações ativas', 'Agendamentos de mensagens e relatórios ativos.', 'automações', 70),
  ('ai_budget_usd_cents', 'limit', 'Orçamento mensal de IA', 'Teto de gasto mensal com IA, em centavos de dólar (US$ 0,01).', 'centavos de US$', 80);

-- ---------------------------------------------------------------------------------------------------
-- Planos e versões
-- ---------------------------------------------------------------------------------------------------
create table private.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  sellable boolean not null default false,
  recommended boolean not null default false,
  sort_order integer not null default 100,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table private.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references private.plans(id) on delete restrict,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  trial_days integer not null default 0 check (trial_days between 0 and 90),
  price_monthly_cents integer check (price_monthly_cents is null or price_monthly_cents between 0 and 100000000),
  price_yearly_cents integer check (price_yearly_cents is null or price_yearly_cents between 0 and 1000000000),
  currency text not null default 'BRL' check (currency = 'BRL'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  unique (plan_id, version),
  check ((status = 'draft') = (published_at is null))
);
create unique index plan_versions_one_draft_idx on private.plan_versions(plan_id) where status = 'draft';
alter table private.plans add constraint plans_current_version_fkey
  foreign key (current_version_id) references private.plan_versions(id) on delete restrict;

-- Linha presente = incluído. Ausência = não incluído (recurso negado / limite 0).
create table private.plan_version_entitlements (
  plan_version_id uuid not null references private.plan_versions(id) on delete cascade,
  key text not null references private.entitlement_definitions(key) on delete restrict,
  enabled boolean not null default true,
  limit_value integer check (limit_value is null or limit_value >= 0),
  unlimited boolean not null default false,
  primary key (plan_version_id, key),
  check (not (unlimited and limit_value is not null))
);

-- Plano de uma organização. kind='administrative' é concessão gratuita feita pelo operador (cortesia, parceiro,
-- organização fundadora), sempre com motivo e auditada. kind='subscription' é reservado à futura integração de
-- pagamento (Asaas): nenhuma função administrativa cria, troca nem remove esse tipo, então uma assinatura paga
-- nunca nasce de uma ativação manual.
create table private.agency_plan_assignments (
  agency_id uuid primary key references public.agencies(id) on delete restrict,
  plan_version_id uuid not null references private.plan_versions(id) on delete restrict,
  kind text not null default 'administrative' check (kind in ('administrative', 'subscription')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  note text check (char_length(note) <= 300),
  check (kind <> 'administrative' or char_length(btrim(coalesce(note, ''))) >= 3)
);

-- Concessões administrativas (não são plano privado nem cupom): registro imutável, só pode ser revogado.
create table private.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  key text not null references private.entitlement_definitions(key) on delete restrict,
  enabled boolean,
  limit_value integer check (limit_value is null or limit_value >= 0),
  unlimited boolean not null default false,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  check (expires_at is null or expires_at > starts_at),
  check (not (unlimited and limit_value is not null))
);
create index entitlement_overrides_active_idx on private.entitlement_overrides(agency_id, key) where revoked_at is null;

alter table private.entitlement_definitions enable row level security;
alter table private.plans enable row level security;
alter table private.plan_versions enable row level security;
alter table private.plan_version_entitlements enable row level security;
alter table private.agency_plan_assignments enable row level security;
alter table private.entitlement_overrides enable row level security;
revoke all on private.entitlement_definitions, private.plans, private.plan_versions, private.plan_version_entitlements,
  private.agency_plan_assignments, private.entitlement_overrides from public, anon, authenticated, service_role;

-- Imutabilidade: versão publicada não muda (só pode ser aposentada); concessão só pode ser revogada.
create function private.guard_plan_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Versões publicadas não podem ser apagadas.' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.plan_id <> old.plan_id or new.version <> old.version then
    raise exception 'Plano e número da versão são imutáveis.' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (
       new.trial_days is distinct from old.trial_days or new.price_monthly_cents is distinct from old.price_monthly_cents
       or new.price_yearly_cents is distinct from old.price_yearly_cents or new.currency is distinct from old.currency
       or new.published_at is distinct from old.published_at or (new.status <> old.status and not (old.status = 'published' and new.status = 'retired'))) then
    raise exception 'Versões publicadas não podem ser alteradas; crie uma nova versão.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_plan_version before update or delete on private.plan_versions
  for each row execute function private.guard_plan_version();

create function private.guard_plan_version_entitlement()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_id uuid := case when tg_op = 'DELETE' then old.plan_version_id else new.plan_version_id end;
begin
  select pv.status into v_status from private.plan_versions pv where pv.id = v_id;
  -- v_status nulo: a versão (rascunho) está sendo apagada em cascata.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Recursos de uma versão publicada não podem ser alterados; crie uma nova versão.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger guard_plan_version_entitlement before insert or update or delete on private.plan_version_entitlements
  for each row execute function private.guard_plan_version_entitlement();

create function private.guard_entitlement_override()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Concessões não são apagadas; revogue-as para manter o histórico.' using errcode = '42501';
  end if;
  if to_jsonb(new) - 'revoked_at' - 'revoked_by' is distinct from to_jsonb(old) - 'revoked_at' - 'revoked_by' or old.revoked_at is not null then
    raise exception 'Concessões só podem ser revogadas, não editadas.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_entitlement_override before update or delete on private.entitlement_overrides
  for each row execute function private.guard_entitlement_override();

-- ---------------------------------------------------------------------------------------------------
-- Resolução dos direitos
-- ---------------------------------------------------------------------------------------------------
create type private.entitlement_result as (managed boolean, kind text, enabled boolean, limit_value integer, unlimited boolean, source text);

create function private.resolve_entitlement(p_agency uuid, p_key text)
returns private.entitlement_result language plpgsql stable security definer set search_path = '' as $$
declare
  d private.entitlement_definitions; ov private.entitlement_overrides; pe private.plan_version_entitlements;
  r private.entitlement_result;
begin
  select * into d from private.entitlement_definitions where key = p_key;
  if not found then raise exception 'Recurso desconhecido: %.', p_key using errcode = '22023'; end if;
  r.managed := exists (select 1 from private.agency_plan_assignments a where a.agency_id = p_agency);
  r.kind := d.kind; r.enabled := false; r.limit_value := null; r.unlimited := false;
  -- 1. Desativação global de segurança vale para todas as organizações, com ou sem plano.
  if d.kind = 'feature' and not d.globally_enabled then r.source := 'global'; return r; end if;
  -- 2. Organização sem plano atribuído: comportamento atual preservado.
  if not r.managed then
    r.source := 'unmanaged';
    if d.kind = 'feature' then r.enabled := true; else r.unlimited := true; end if;
    return r;
  end if;
  -- 3. Concessão ativa (a mais recente).
  select * into ov from private.entitlement_overrides o
  where o.agency_id = p_agency and o.key = p_key and o.revoked_at is null and o.starts_at <= now()
    and (o.expires_at is null or o.expires_at > now())
  order by o.created_at desc limit 1;
  if found then
    r.source := 'override';
    if d.kind = 'feature' then r.enabled := coalesce(ov.enabled, false);
    else r.unlimited := ov.unlimited; r.limit_value := ov.limit_value; end if;
  else
    -- 4. Versão do plano atribuída; ausência = não incluído.
    select e.* into pe from private.plan_version_entitlements e
    join private.agency_plan_assignments a on a.plan_version_id = e.plan_version_id
    where a.agency_id = p_agency and e.key = p_key;
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

-- Retorna null quando não há restrição; senão o limite (>= 0), já com a trava da organização/recurso adquirida
-- até o fim da transação, para que inserções simultâneas não ultrapassem o limite.
create function private.limit_gate(p_agency uuid, p_key text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare r private.entitlement_result;
begin
  r := private.resolve_entitlement(p_agency, p_key);
  if not r.managed or r.unlimited then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement:' || p_agency::text || ':' || p_key, 0));
  return coalesce(r.limit_value, 0);
end $$;

create function private.limit_exceeded(p_key text, p_limit integer)
returns void language plpgsql stable set search_path = '' as $$
declare v_label text;
begin
  select label into v_label from private.entitlement_definitions where key = p_key;
  raise exception 'Limite do plano atingido: % (máximo %). Fale com o suporte para ampliar.', lower(v_label), p_limit using errcode = '53400';
end $$;

create function private.feature_gate(p_agency uuid, p_key text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r private.entitlement_result; v_label text;
begin
  r := private.resolve_entitlement(p_agency, p_key);
  if not r.enabled then
    select label into v_label from private.entitlement_definitions where key = p_key;
    raise exception 'Recurso indisponível no plano desta organização: %.', lower(v_label) using errcode = '42501';
  end if;
end $$;

create function private.usage_of(p_agency uuid, p_key text)
returns bigint language sql stable security definer set search_path = '' as $$
  select case p_key
    when 'clients' then (select count(*) from public.clients c where c.agency_id = p_agency and c.archived_at is null)
    when 'team_members' then (select count(*) from public.agency_users au where au.agency_id = p_agency)
      + (select count(*) from public.agency_invitations i where i.agency_id = p_agency and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    when 'ad_accounts' then (select count(distinct x.ad_account_id) from public.client_ad_accounts x where x.agency_id = p_agency and x.active)
      + (select count(distinct g.google_ad_account_id) from public.client_google_accounts g where g.agency_id = p_agency and g.active)
    when 'whatsapp_numbers' then (select count(*) from public.whatsapp_connections w where w.agency_id = p_agency)
    when 'report_automations' then (select count(*) from public.report_automations a where a.agency_id = p_agency and a.active)
    when 'ai_budget_usd_cents' then (select round(coalesce(sum(u.cost_usd), 0) * 100)::bigint from public.ai_usage u
      where u.agency_id = p_agency and u.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc')
    else null
  end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Aplicação dos limites no banco (valem para app, APIs, jobs e funções)
-- ---------------------------------------------------------------------------------------------------
create function private.enforce_clients_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  if new.archived_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.archived_at is null then return new; end if;
  v_limit := private.limit_gate(new.agency_id, 'clients');
  if v_limit is null then return new; end if;
  if (select count(*) from public.clients c where c.agency_id = new.agency_id and c.archived_at is null and c.id <> new.id) + 1 > v_limit then
    perform private.limit_exceeded('clients', v_limit);
  end if;
  return new;
end $$;
create trigger enforce_clients_limit before insert or update of archived_at on public.clients
  for each row execute function private.enforce_clients_limit();

create function private.enforce_team_members_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer; v_used bigint;
begin
  v_limit := private.limit_gate(new.agency_id, 'team_members');
  if v_limit is null then return new; end if;
  if tg_table_name = 'agency_users' then
    -- Quem aceita um convite já foi contado como pendente: aqui só contam os membros efetivos.
    select count(*) into v_used from public.agency_users au where au.agency_id = new.agency_id;
  else
    v_used := private.usage_of(new.agency_id, 'team_members');
  end if;
  if v_used + 1 > v_limit then perform private.limit_exceeded('team_members', v_limit); end if;
  return new;
end $$;
create trigger enforce_team_members_limit before insert on public.agency_users
  for each row execute function private.enforce_team_members_limit();
create trigger enforce_team_members_limit before insert on public.agency_invitations
  for each row execute function private.enforce_team_members_limit();

-- Uma conta já vinculada a outro cliente não aumenta o total. Duas funções (uma por tabela) porque o registro NEW
-- de cada tabela tem colunas diferentes.
create function private.enforce_meta_ad_accounts_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  v_limit := private.limit_gate(new.agency_id, 'ad_accounts');
  if v_limit is null then return new; end if;
  if exists (select 1 from public.client_ad_accounts x where x.agency_id = new.agency_id
       and x.ad_account_id = new.ad_account_id and x.active and x.client_id <> new.client_id) then return new; end if;
  if (select count(distinct x.ad_account_id) from public.client_ad_accounts x where x.agency_id = new.agency_id and x.active
        and not (x.client_id = new.client_id and x.ad_account_id = new.ad_account_id))
   + (select count(distinct g.google_ad_account_id) from public.client_google_accounts g where g.agency_id = new.agency_id and g.active) + 1 > v_limit then
    perform private.limit_exceeded('ad_accounts', v_limit);
  end if;
  return new;
end $$;
create trigger enforce_ad_accounts_limit before insert or update of active on public.client_ad_accounts
  for each row execute function private.enforce_meta_ad_accounts_limit();

create function private.enforce_google_ad_accounts_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  v_limit := private.limit_gate(new.agency_id, 'ad_accounts');
  if v_limit is null then return new; end if;
  if exists (select 1 from public.client_google_accounts g where g.agency_id = new.agency_id
       and g.google_ad_account_id = new.google_ad_account_id and g.active and g.client_id <> new.client_id) then return new; end if;
  if (select count(distinct x.ad_account_id) from public.client_ad_accounts x where x.agency_id = new.agency_id and x.active)
   + (select count(distinct g.google_ad_account_id) from public.client_google_accounts g where g.agency_id = new.agency_id and g.active
        and not (g.client_id = new.client_id and g.google_ad_account_id = new.google_ad_account_id)) + 1 > v_limit then
    perform private.limit_exceeded('ad_accounts', v_limit);
  end if;
  return new;
end $$;
create trigger enforce_ad_accounts_limit before insert or update of active on public.client_google_accounts
  for each row execute function private.enforce_google_ad_accounts_limit();

create function private.enforce_whatsapp_numbers_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  -- Regravar um número que já existe (ex.: renovar credencial) não cria um número novo.
  if exists (select 1 from public.whatsapp_connections w where w.phone_number_id = new.phone_number_id) then return new; end if;
  v_limit := private.limit_gate(new.agency_id, 'whatsapp_numbers');
  if v_limit is null then return new; end if;
  if (select count(*) from public.whatsapp_connections w where w.agency_id = new.agency_id) + 1 > v_limit then
    perform private.limit_exceeded('whatsapp_numbers', v_limit);
  end if;
  return new;
end $$;
create trigger enforce_whatsapp_numbers_limit before insert on public.whatsapp_connections
  for each row execute function private.enforce_whatsapp_numbers_limit();

create function private.enforce_automations_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active then return new; end if;
  v_limit := private.limit_gate(new.agency_id, 'report_automations');
  if v_limit is null then return new; end if;
  if (select count(*) from public.report_automations a where a.agency_id = new.agency_id and a.active and a.id <> new.id) + 1 > v_limit then
    perform private.limit_exceeded('report_automations', v_limit);
  end if;
  return new;
end $$;
create trigger enforce_automations_limit before insert or update of active on public.report_automations
  for each row execute function private.enforce_automations_limit();

create function private.enforce_client_portal_feature()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'client_users' then
    if not new.active then return new; end if;
    if tg_op = 'UPDATE' and old.active then return new; end if;
  end if;
  perform private.feature_gate(new.agency_id, 'client_portal');
  return new;
end $$;
create trigger enforce_client_portal_feature before insert or update of active on public.client_users
  for each row execute function private.enforce_client_portal_feature();
create trigger enforce_client_portal_feature before insert on public.client_portal_invitations
  for each row execute function private.enforce_client_portal_feature();

-- ---------------------------------------------------------------------------------------------------
-- Leitura pela organização e pelo servidor
-- ---------------------------------------------------------------------------------------------------
create function public.get_agency_entitlements(p_agency_id uuid)
returns table (key text, kind text, label text, unit text, managed boolean, enabled boolean, limit_value integer, unlimited boolean, source text, used bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.agency_role(p_agency_id) is null then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
    select d.key, d.kind, d.label, d.unit, r.managed, r.enabled, r.limit_value, r.unlimited, r.source,
           case when d.kind = 'limit' then private.usage_of(p_agency_id, d.key) end
    from private.entitlement_definitions d
    cross join lateral (select (private.resolve_entitlement(p_agency_id, d.key)).*) r
    order by d.sort_order;
end $$;

-- Só o servidor (IA): permissão e teto de gasto mensal, em dólares (null = sem teto comercial).
create function public.agency_ai_entitlement(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f private.entitlement_result; b private.entitlement_result;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operação não autorizada.' using errcode = '42501'; end if;
  f := private.resolve_entitlement(p_agency_id, 'ai_assistant');
  b := private.resolve_entitlement(p_agency_id, 'ai_budget_usd_cents');
  return jsonb_build_object('allowed', f.enabled,
    'budget_usd', case when b.managed and not b.unlimited then coalesce(b.limit_value, 0) / 100.0 end);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Administração (operador da plataforma com MFA); toda alteração grava a auditoria da plataforma
-- ---------------------------------------------------------------------------------------------------
create function private.require_operator()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if private.platform_operator_role(true) is null then
    raise exception 'Acesso restrito aos operadores da plataforma com verificação em duas etapas.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create function private.audit_platform(p_action text, p_type text, p_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into private.platform_audit_log(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), p_action, p_type, p_id, 'success', p_meta);
$$;

create function public.platform_list_definitions()
returns table (key text, kind text, label text, description text, unit text, globally_enabled boolean, disabled_reason text, disabled_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return query select d.key, d.kind, d.label, d.description, d.unit, d.globally_enabled, d.disabled_reason, d.disabled_at
    from private.entitlement_definitions d order by d.sort_order;
end $$;

create function public.platform_agency_entitlements(p_agency_id uuid)
returns table (key text, kind text, label text, unit text, managed boolean, enabled boolean, limit_value integer, unlimited boolean, source text, used bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return query
    select d.key, d.kind, d.label, d.unit, r.managed, r.enabled, r.limit_value, r.unlimited, r.source,
           case when d.kind = 'limit' then private.usage_of(p_agency_id, d.key) end
    from private.entitlement_definitions d
    cross join lateral (select (private.resolve_entitlement(p_agency_id, d.key)).*) r
    order by d.sort_order;
end $$;

create function public.platform_set_feature_switch(p_key text, p_enabled boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator();
begin
  if not exists (select 1 from private.entitlement_definitions where key = p_key and kind = 'feature') then
    raise exception 'Só funcionalidades (não limites) têm interruptor global.' using errcode = '22023';
  end if;
  if not p_enabled and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo da desativação.' using errcode = '22023';
  end if;
  update private.entitlement_definitions set globally_enabled = p_enabled,
    disabled_reason = case when p_enabled then null else btrim(p_reason) end,
    disabled_at = case when p_enabled then null else now() end,
    disabled_by = case when p_enabled then null else v_actor end
  where key = p_key;
  perform private.audit_platform(case when p_enabled then 'commercial.feature_enabled' else 'commercial.feature_disabled' end,
    'entitlement', p_key, jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 200)));
end $$;

create function public.platform_list_plans()
returns table (plan_id uuid, key text, name text, visibility text, sellable boolean, recommended boolean, sort_order integer,
  current_version integer, current_version_id uuid, price_monthly_cents integer, price_yearly_cents integer, trial_days integer, has_draft boolean, assigned_orgs bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return query
    select p.id, p.key, p.name, p.visibility, p.sellable, p.recommended, p.sort_order, v.version, v.id, v.price_monthly_cents, v.price_yearly_cents, v.trial_days,
      exists (select 1 from private.plan_versions dv where dv.plan_id = p.id and dv.status = 'draft'),
      (select count(*) from private.agency_plan_assignments a join private.plan_versions av on av.id = a.plan_version_id where av.plan_id = p.id)
    from private.plans p left join private.plan_versions v on v.id = p.current_version_id
    order by p.sort_order, p.name;
end $$;

create function public.platform_get_plan(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_operator();
  select jsonb_build_object(
    'plan', jsonb_build_object('id', p.id, 'key', p.key, 'name', p.name, 'description', p.description, 'visibility', p.visibility,
      'sellable', p.sellable, 'recommended', p.recommended, 'sort_order', p.sort_order, 'current_version_id', p.current_version_id),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'trial_days', v.trial_days,
        'price_monthly_cents', v.price_monthly_cents, 'price_yearly_cents', v.price_yearly_cents, 'published_at', v.published_at,
        'assigned_orgs', (select count(*) from private.agency_plan_assignments a where a.plan_version_id = v.id),
        'entitlements', coalesce((select jsonb_agg(jsonb_build_object('key', e.key, 'enabled', e.enabled, 'limit', e.limit_value, 'unlimited', e.unlimited) order by e.key)
          from private.plan_version_entitlements e where e.plan_version_id = v.id), '[]'::jsonb)) order by v.version desc)
      from private.plan_versions v where v.plan_id = p.id), '[]'::jsonb))
  into v_result from private.plans p where p.id = p_plan_id;
  if v_result is null then raise exception 'Plano não encontrado.' using errcode = '22023'; end if;
  return v_result;
end $$;

create function public.platform_create_plan(p_key text, p_name text, p_description text, p_visibility text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); v_id uuid;
begin
  insert into private.plans(key, name, description, visibility, created_by)
  values (lower(btrim(p_key)), btrim(p_name), coalesce(btrim(p_description), ''), p_visibility, v_actor) returning id into v_id;
  insert into private.plan_versions(plan_id, version, created_by) values (v_id, 1, v_actor);
  perform private.audit_platform('commercial.plan_created', 'plan', v_id::text, jsonb_build_object('key', lower(btrim(p_key))));
  return v_id;
end $$;

create function public.platform_update_plan(p_plan_id uuid, p_name text, p_description text, p_visibility text,
  p_sellable boolean, p_recommended boolean, p_sort_order integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_version private.plan_versions;
begin
  perform private.require_operator();
  if p_sellable then
    select pv.* into v_version from private.plans p join private.plan_versions pv on pv.id = p.current_version_id where p.id = p_plan_id;
    if not found or (v_version.price_monthly_cents is null and v_version.price_yearly_cents is null) then
      raise exception 'Para vender o plano, publique uma versão com pelo menos um preço (mensal ou anual).' using errcode = '22023';
    end if;
  end if;
  update private.plans set name = btrim(p_name), description = coalesce(btrim(p_description), ''), visibility = p_visibility,
    sellable = p_sellable, recommended = p_recommended, sort_order = p_sort_order, updated_at = now() where id = p_plan_id;
  if not found then raise exception 'Plano não encontrado.' using errcode = '22023'; end if;
  perform private.audit_platform('commercial.plan_updated', 'plan', p_plan_id::text,
    jsonb_build_object('visibility', p_visibility, 'sellable', p_sellable, 'recommended', p_recommended));
end $$;

create function public.platform_start_draft(p_plan_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); v_current private.plan_versions; v_draft uuid; v_next integer;
begin
  perform 1 from private.plans where id = p_plan_id for update;
  if not found then raise exception 'Plano não encontrado.' using errcode = '22023'; end if;
  if exists (select 1 from private.plan_versions where plan_id = p_plan_id and status = 'draft') then
    raise exception 'Já existe um rascunho para este plano.' using errcode = '23505';
  end if;
  select pv.* into v_current from private.plans p join private.plan_versions pv on pv.id = p.current_version_id where p.id = p_plan_id;
  select coalesce(max(version), 0) + 1 into v_next from private.plan_versions where plan_id = p_plan_id;
  insert into private.plan_versions(plan_id, version, trial_days, price_monthly_cents, price_yearly_cents, created_by)
  values (p_plan_id, v_next, coalesce(v_current.trial_days, 0), v_current.price_monthly_cents, v_current.price_yearly_cents, v_actor) returning id into v_draft;
  if v_current.id is not null then
    insert into private.plan_version_entitlements(plan_version_id, key, enabled, limit_value, unlimited)
    select v_draft, e.key, e.enabled, e.limit_value, e.unlimited from private.plan_version_entitlements e where e.plan_version_id = v_current.id;
  end if;
  perform private.audit_platform('commercial.draft_started', 'plan', p_plan_id::text, jsonb_build_object('version', v_next));
  return v_draft;
end $$;

-- p_entitlements: [{"key":"clients","limit":10}, {"key":"team_members","unlimited":true}, {"key":"ai_assistant","enabled":true}]
-- Recursos ausentes da lista ficam "não incluídos".
create function public.platform_save_draft(p_plan_id uuid, p_trial_days integer, p_price_monthly_cents integer,
  p_price_yearly_cents integer, p_entitlements jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_draft uuid; el jsonb; d private.entitlement_definitions; v_count integer := 0;
begin
  perform private.require_operator();
  perform 1 from private.plans where id = p_plan_id for update;
  select id into v_draft from private.plan_versions where plan_id = p_plan_id and status = 'draft';
  if v_draft is null then raise exception 'Não há rascunho. Crie uma nova versão para editar.' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_entitlements, '[]'::jsonb)) <> 'array' then raise exception 'Formato de recursos inválido.' using errcode = '22023'; end if;
  if p_price_monthly_cents is not null and p_price_yearly_cents is not null and p_price_yearly_cents > p_price_monthly_cents * 12 then
    raise exception 'O preço anual não pode ser maior que 12 mensalidades.' using errcode = '22023';
  end if;
  update private.plan_versions set trial_days = p_trial_days, price_monthly_cents = p_price_monthly_cents, price_yearly_cents = p_price_yearly_cents where id = v_draft;
  delete from private.plan_version_entitlements where plan_version_id = v_draft;
  for el in select * from jsonb_array_elements(coalesce(p_entitlements, '[]'::jsonb)) loop
    select * into d from private.entitlement_definitions where key = el ->> 'key';
    if not found then raise exception 'Recurso desconhecido: %.', el ->> 'key' using errcode = '22023'; end if;
    if d.kind = 'feature' then
      if coalesce((el ->> 'enabled')::boolean, false) then
        insert into private.plan_version_entitlements(plan_version_id, key, enabled) values (v_draft, d.key, true);
        v_count := v_count + 1;
      end if;
    elsif coalesce((el ->> 'unlimited')::boolean, false) then
      insert into private.plan_version_entitlements(plan_version_id, key, unlimited) values (v_draft, d.key, true);
      v_count := v_count + 1;
    elsif el ->> 'limit' is not null then
      insert into private.plan_version_entitlements(plan_version_id, key, limit_value) values (v_draft, d.key, (el ->> 'limit')::integer);
      v_count := v_count + 1;
    end if;
  end loop;
  perform private.audit_platform('commercial.draft_saved', 'plan', p_plan_id::text, jsonb_build_object('entitlements', v_count));
end $$;

create function public.platform_discard_draft(p_plan_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_draft private.plan_versions;
begin
  perform private.require_operator();
  perform 1 from private.plans where id = p_plan_id for update;
  select * into v_draft from private.plan_versions where plan_id = p_plan_id and status = 'draft';
  if not found then raise exception 'Não há rascunho.' using errcode = '22023'; end if;
  if (select current_version_id from private.plans where id = p_plan_id) is null then
    raise exception 'A primeira versão do plano não pode ser descartada; edite-a e publique.' using errcode = '22023';
  end if;
  delete from private.plan_versions where id = v_draft.id;
  perform private.audit_platform('commercial.draft_discarded', 'plan', p_plan_id::text, jsonb_build_object('version', v_draft.version));
end $$;

create function public.platform_publish_draft(p_plan_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); v_draft private.plan_versions; v_old uuid;
begin
  -- A trava da linha do plano serializa publicações simultâneas; o rascunho só é lido depois dela.
  select current_version_id into v_old from private.plans where id = p_plan_id for update;
  if not found then raise exception 'Plano não encontrado.' using errcode = '22023'; end if;
  select * into v_draft from private.plan_versions where plan_id = p_plan_id and status = 'draft';
  if not found then raise exception 'Não há rascunho para publicar.' using errcode = '22023'; end if;
  update private.plan_versions set status = 'published', published_at = now(), published_by = v_actor where id = v_draft.id;
  if v_old is not null then update private.plan_versions set status = 'retired' where id = v_old; end if;
  update private.plans set current_version_id = v_draft.id, updated_at = now(),
    sellable = sellable and (v_draft.price_monthly_cents is not null or v_draft.price_yearly_cents is not null)
  where id = p_plan_id;
  perform private.audit_platform('commercial.version_published', 'plan', p_plan_id::text, jsonb_build_object('version', v_draft.version));
  return v_draft.version;
end $$;

create function public.platform_list_agencies(p_query text default null, p_limit integer default 50)
returns table (agency_id uuid, name text, created_at timestamptz, members bigint, clients bigint, plan_name text, plan_version integer,
  plan_version_id uuid, assigned_at timestamptz, assignment_kind text, active_overrides bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return query
    select a.id, a.name, a.created_at,
      (select count(*) from public.agency_users au where au.agency_id = a.id),
      (select count(*) from public.clients c where c.agency_id = a.id and c.archived_at is null),
      p.name, v.version, v.id, asg.assigned_at, asg.kind,
      (select count(*) from private.entitlement_overrides o where o.agency_id = a.id and o.revoked_at is null and (o.expires_at is null or o.expires_at > now()))
    from public.agencies a
    left join private.agency_plan_assignments asg on asg.agency_id = a.id
    left join private.plan_versions v on v.id = asg.plan_version_id
    left join private.plans p on p.id = v.plan_id
    where p_query is null or btrim(p_query) = '' or a.name ilike '%' || btrim(p_query) || '%' or a.id::text = btrim(p_query)
    order by a.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

-- Retorna, por informação, o que já passa do limite do novo plano (nada é removido: só novas adições são bloqueadas).
create function public.platform_assign_plan(p_agency_id uuid, p_plan_version_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); v_status text; d private.entitlement_definitions; r private.entitlement_result;
  v_used bigint; v_over jsonb := '[]'::jsonb;
begin
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Informe o motivo da concessão (ex.: parceiro, cortesia, organização fundadora).' using errcode = '22023';
  end if;
  if exists (select 1 from private.agency_plan_assignments where agency_id = p_agency_id and kind = 'subscription') then
    raise exception 'Esta organização tem uma assinatura paga; ela não pode ser alterada por atribuição administrativa.' using errcode = '22023';
  end if;
  select status into v_status from private.plan_versions where id = p_plan_version_id;
  if v_status is distinct from 'published' then raise exception 'Só versões publicadas e atuais podem ser atribuídas.' using errcode = '22023'; end if;
  if not exists (select 1 from public.agencies where id = p_agency_id) then raise exception 'Organização não encontrada.' using errcode = '22023'; end if;
  insert into private.agency_plan_assignments(agency_id, plan_version_id, kind, assigned_by, note)
  values (p_agency_id, p_plan_version_id, 'administrative', v_actor, left(btrim(p_note), 300))
  on conflict (agency_id) do update set plan_version_id = excluded.plan_version_id, kind = 'administrative',
    assigned_by = excluded.assigned_by, assigned_at = now(), note = excluded.note;
  for d in select * from private.entitlement_definitions where kind = 'limit' order by sort_order loop
    r := private.resolve_entitlement(p_agency_id, d.key);
    v_used := private.usage_of(p_agency_id, d.key);
    if not r.unlimited and v_used > coalesce(r.limit_value, 0) then
      v_over := v_over || jsonb_build_object('key', d.key, 'label', d.label, 'used', v_used, 'limit', coalesce(r.limit_value, 0));
    end if;
  end loop;
  perform private.audit_platform('commercial.plan_granted_admin', 'agency', p_agency_id::text,
    jsonb_build_object('plan_version_id', p_plan_version_id, 'over_limit', jsonb_array_length(v_over), 'reason', left(btrim(p_note), 150)));
  return jsonb_build_object('over_limit', v_over);
end $$;

create function public.platform_unassign_plan(p_agency_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_operator();
  if exists (select 1 from private.agency_plan_assignments where agency_id = p_agency_id and kind = 'subscription') then
    raise exception 'Assinatura paga não pode ser removida por aqui.' using errcode = '22023';
  end if;
  delete from private.agency_plan_assignments where agency_id = p_agency_id;
  if not found then raise exception 'A organização não tem plano atribuído.' using errcode = '22023'; end if;
  perform private.audit_platform('commercial.plan_unassigned', 'agency', p_agency_id::text);
end $$;

create function public.platform_list_overrides(p_agency_id uuid default null)
returns table (id uuid, agency_id uuid, agency_name text, key text, label text, enabled boolean, limit_value integer, unlimited boolean,
  starts_at timestamptz, expires_at timestamptz, reason text, granted_by_email text, created_at timestamptz, revoked_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_operator();
  return query
    select o.id, o.agency_id, a.name, o.key, d.label, o.enabled, o.limit_value, o.unlimited, o.starts_at, o.expires_at, o.reason, u.email::text, o.created_at, o.revoked_at,
      case when o.revoked_at is not null then 'revogada' when o.starts_at > now() then 'agendada'
           when o.expires_at is not null and o.expires_at <= now() then 'expirada' else 'ativa' end
    from private.entitlement_overrides o
    join public.agencies a on a.id = o.agency_id
    join private.entitlement_definitions d on d.key = o.key
    left join auth.users u on u.id = o.granted_by
    where p_agency_id is null or o.agency_id = p_agency_id
    order by o.created_at desc limit 200;
end $$;

create function public.platform_grant_override(p_agency_id uuid, p_key text, p_enabled boolean, p_limit integer,
  p_unlimited boolean, p_expires_at timestamptz, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); d private.entitlement_definitions; v_id uuid;
begin
  select * into d from private.entitlement_definitions where key = p_key;
  if not found then raise exception 'Recurso desconhecido.' using errcode = '22023'; end if;
  if not exists (select 1 from private.agency_plan_assignments where agency_id = p_agency_id) then
    raise exception 'A organização não tem plano atribuído: ela já não tem restrições comerciais e a concessão não teria efeito.' using errcode = '22023';
  end if;
  if d.kind = 'feature' and p_enabled is null then raise exception 'Informe se o recurso é liberado ou bloqueado.' using errcode = '22023'; end if;
  if d.kind = 'limit' and not coalesce(p_unlimited, false) and p_limit is null then raise exception 'Informe o limite ou marque ilimitado.' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'O prazo precisa estar no futuro.' using errcode = '22023'; end if;
  insert into private.entitlement_overrides(agency_id, key, enabled, limit_value, unlimited, expires_at, reason, granted_by)
  values (p_agency_id, p_key, case when d.kind = 'feature' then p_enabled end,
          case when d.kind = 'limit' and not coalesce(p_unlimited, false) then p_limit end,
          d.kind = 'limit' and coalesce(p_unlimited, false), p_expires_at, btrim(p_reason), v_actor)
  returning id into v_id;
  perform private.audit_platform('commercial.override_granted', 'agency', p_agency_id::text,
    jsonb_build_object('key', p_key, 'override_id', v_id, 'expires', p_expires_at is not null));
  return v_id;
end $$;

create function public.platform_revoke_override(p_override_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := private.require_operator(); v_agency uuid;
begin
  update private.entitlement_overrides set revoked_at = now(), revoked_by = v_actor
  where id = p_override_id and revoked_at is null returning agency_id into v_agency;
  if v_agency is null then raise exception 'Concessão não encontrada ou já revogada.' using errcode = '22023'; end if;
  perform private.audit_platform('commercial.override_revoked', 'agency', v_agency::text, jsonb_build_object('override_id', p_override_id));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
    and p.proname = any(array['guard_plan_version', 'guard_plan_version_entitlement', 'guard_entitlement_override', 'resolve_entitlement',
      'limit_gate', 'limit_exceeded', 'feature_gate', 'usage_of', 'enforce_clients_limit', 'enforce_team_members_limit',
      'enforce_meta_ad_accounts_limit', 'enforce_google_ad_accounts_limit', 'enforce_whatsapp_numbers_limit', 'enforce_automations_limit', 'enforce_client_portal_feature',
      'require_operator', 'audit_platform', 'platform_audit_immutable', 'guard_platform_operator']) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname = any(array['get_agency_entitlements', 'platform_list_definitions', 'platform_agency_entitlements', 'platform_set_feature_switch', 'platform_list_plans',
      'platform_get_plan', 'platform_create_plan', 'platform_update_plan', 'platform_start_draft', 'platform_save_draft',
      'platform_discard_draft', 'platform_publish_draft', 'platform_list_agencies', 'platform_assign_plan', 'platform_unassign_plan',
      'platform_list_overrides', 'platform_grant_override', 'platform_revoke_override']) loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.agency_ai_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.agency_ai_entitlement(uuid) to service_role;
