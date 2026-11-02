-- Menu "Leads" do cliente (etapa 1): funil de status, histórico, formulários da Meta e links compartilhados.
-- Aditiva sobre 202611020001_lead_pages: acrescenta colunas com valor padrão em `leads` e cria 3 tabelas novas. Nada é apagado nem
-- reescrito. Recuperação: as colunas e tabelas novas podem ser descartadas sem afetar nenhum outro dado.
-- Todos os dados são pessoais: acesso só pelo servidor (service_role), sem política para anon/authenticated.

-- Canal do lead (hoje só formulário; WhatsApp e Instagram entram nas próximas etapas) e funil de atendimento.
alter table public.leads
  add column if not exists channel text not null default 'form' check (channel in ('form', 'whatsapp', 'instagram')),
  add column if not exists status text not null default 'new' check (status in ('new', 'contacted', 'visit', 'won', 'lost')),
  add column if not exists status_changed_at timestamptz;

create index if not exists leads_page_status_idx on public.leads (lead_page_id, status);

-- Última conferência com a Meta (leads e formulários) por fonte de leads (Página do Facebook).
alter table public.lead_pages
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_error text check (sync_error is null or char_length(sync_error) <= 500);

-- Formulários da Página (nome para os filtros). Preenchida na sincronização com a Meta.
create table if not exists public.lead_forms (
  lead_page_id uuid not null references public.lead_pages (id) on delete restrict,
  form_id text not null check (form_id ~ '^[0-9]{5,30}$'),
  name text not null check (char_length(name) between 1 and 300),
  status text check (status is null or char_length(status) <= 40),
  updated_at timestamptz not null default now(),
  primary key (lead_page_id, form_id)
);

-- Histórico do lead: mudanças de status e notas. Quem fez fica em `actor` (nome da pessoa ou "Link: <nome>").
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete restrict,
  kind text not null check (kind in ('status', 'note')),
  status text check (status is null or status in ('new', 'contacted', 'visit', 'won', 'lost')),
  body text check (body is null or char_length(body) between 1 and 2000),
  actor text not null check (char_length(actor) between 1 and 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint lead_events_content check ((kind = 'status' and status is not null) or (kind = 'note' and body is not null))
);
create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

-- Links compartilhados do cliente (sem login). Vários por cliente, com nome, escopo de formulários e revogação.
-- O código nunca é guardado: só o SHA-256 (hex).
create table if not exists public.lead_share_links (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete restrict,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  access_hash text not null unique check (access_hash ~ '^[0-9a-f]{64}$'),
  -- null = todos os formulários do cliente.
  form_ids text[],
  -- Se a pessoa do link pode mudar status e escrever notas (por padrão só vê).
  can_update boolean not null default false,
  active boolean not null default true,
  last_opened_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint lead_share_links_client_fkey foreign key (agency_id, client_id)
    references public.clients (agency_id, id) on delete restrict
);
create index if not exists lead_share_links_client_idx on public.lead_share_links (client_id) where active;

alter table public.lead_forms enable row level security;
alter table public.lead_events enable row level security;
alter table public.lead_share_links enable row level security;

revoke all on table public.lead_forms, public.lead_events, public.lead_share_links from anon, authenticated;
grant select, insert, update on table public.lead_forms to service_role;
grant select, insert on table public.lead_events to service_role;
grant select, insert, update on table public.lead_share_links to service_role;
-- Só o status pode mudar em um lead já recebido (os dados do contato nunca são reescritos pela aplicação).
grant update (status, status_changed_at) on table public.leads to service_role;
grant update (last_synced_at, sync_error) on table public.lead_pages to service_role;

-- O link original de cada página de leads (já entregue ao cliente) passa a existir também como link compartilhado do cliente.
insert into public.lead_share_links (agency_id, client_id, name, access_hash)
select p.agency_id, p.client_id, 'Link da equipe (original)', p.access_hash
from public.lead_pages p
where p.client_id is not null and p.active
on conflict (access_hash) do nothing;

comment on table public.lead_share_links is 'Links privados (sem login) para ver os leads de um cliente. Só o hash do código é guardado.';
comment on table public.lead_events is 'Histórico de status e notas dos leads. Dados pessoais: acesso só pelo servidor.';
comment on table public.lead_forms is 'Formulários de lead da Página (nomes para filtro), vindos da Meta.';
