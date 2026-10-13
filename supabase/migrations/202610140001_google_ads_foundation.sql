-- Google Ads: conexão da organização (uma conta de gerente / OAuth), contas de anúncios e vínculo com os clientes.
-- O token de acesso fica cifrado em private.integration_secrets (integração 'google', já prevista no catálogo de provedores).
-- Os números não são copiados para o banco: são lidos da API no momento do relatório.

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  integration_id uuid not null,
  -- Conta de gerente (MCC) usada no acesso às contas dos clientes, 10 dígitos.
  login_customer_id text check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$'),
  google_email text,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  last_accounts_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, integration_id),
  unique (agency_id, id),
  foreign key (agency_id, integration_id) references public.integrations(agency_id, id) on delete restrict
);

create table public.google_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  google_connection_id uuid not null,
  customer_id text not null check (customer_id ~ '^[0-9]{10}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  timezone_name text not null default 'America/Sao_Paulo' check (char_length(timezone_name) between 3 and 64),
  status text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, google_connection_id, customer_id),
  unique (agency_id, id),
  foreign key (agency_id, google_connection_id) references public.google_connections(agency_id, id) on delete restrict
);
create index google_ad_accounts_agency_active_idx on public.google_ad_accounts(agency_id, archived_at, name);

create table public.client_google_accounts (
  agency_id uuid not null,
  client_id uuid not null,
  google_ad_account_id uuid not null,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agency_id, client_id, google_ad_account_id),
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete restrict,
  foreign key (agency_id, google_ad_account_id) references public.google_ad_accounts(agency_id, id) on delete restrict,
  constraint client_google_accounts_creator_fkey foreign key (agency_id, created_by)
    references public.agency_users(agency_id, user_id) on delete set null (created_by)
);
create index client_google_accounts_client_idx on public.client_google_accounts(agency_id, client_id, active);

create trigger google_connections_touch before update on public.google_connections
for each row execute function private.touch_meta_updated_at();
create trigger google_ad_accounts_touch before update on public.google_ad_accounts
for each row execute function private.touch_meta_updated_at();
create trigger client_google_accounts_touch before update on public.client_google_accounts
for each row execute function private.touch_meta_updated_at();

alter table public.google_connections enable row level security;
alter table public.google_ad_accounts enable row level security;
alter table public.client_google_accounts enable row level security;

revoke all on table public.google_connections, public.google_ad_accounts, public.client_google_accounts from public, anon, authenticated;
grant select on table public.google_connections, public.google_ad_accounts, public.client_google_accounts to authenticated;
-- Vincular uma conta a um cliente: dono, administrador e editor (mesma regra das contas da Meta).
grant insert (agency_id, client_id, google_ad_account_id, active) on public.client_google_accounts to authenticated;
grant update (active) on public.client_google_accounts to authenticated;
grant all on table public.google_connections, public.google_ad_accounts, public.client_google_accounts to service_role;

create policy google_connections_read on public.google_connections for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy google_ad_accounts_read on public.google_ad_accounts for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy client_google_accounts_read on public.client_google_accounts for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy client_google_accounts_insert on public.client_google_accounts for insert to authenticated
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
create policy client_google_accounts_update on public.client_google_accounts for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));
