-- Páginas de acompanhamento de leads (formulário instantâneo da Meta / Lead Ads).
-- Cada página é um link privado (código secreto, guardado só como hash) que mostra, quase em tempo real, os cadastros que a Meta envia
-- pelo webhook "leadgen" para uma Página do Facebook. Os leads são dados pessoais: ficam só no servidor (service_role), sem nenhuma
-- política para anon/authenticated.
--
-- Migração ADITIVA: cria duas tabelas novas e não toca em nenhuma tabela existente. Recuperação: as tabelas podem ser descartadas sem
-- afetar nenhum outro dado.

create table if not exists public.lead_pages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete restrict,
  client_id uuid,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  -- Página do Facebook que recebe os leads; form_id opcional restringe a um formulário.
  fb_page_id text not null check (fb_page_id ~ '^[0-9]{5,30}$'),
  form_id text check (form_id is null or form_id ~ '^[0-9]{5,30}$'),
  -- SHA-256 (hex) do código secreto do link; o código em si nunca é guardado.
  access_hash text not null check (access_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  constraint lead_pages_client_fkey foreign key (agency_id, client_id)
    references public.clients (agency_id, id) on delete restrict
);

create index if not exists lead_pages_fb_page_idx on public.lead_pages (fb_page_id) where active;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_page_id uuid not null references public.lead_pages (id) on delete restrict,
  leadgen_id text not null check (char_length(leadgen_id) between 5 and 64),
  name text check (name is null or char_length(name) <= 300),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 320),
  field_data jsonb not null default '[]'::jsonb,
  form_id text,
  ad_id text,
  adset_id text,
  campaign_id text,
  -- Quando a pessoa enviou o formulário (hora da Meta) e quando a Groow recebeu o aviso.
  created_time timestamptz not null default now(),
  received_at timestamptz not null default now(),
  -- A Meta pode repetir o aviso: o mesmo lead nunca é gravado duas vezes na mesma página.
  unique (lead_page_id, leadgen_id)
);

create index if not exists leads_page_time_idx on public.leads (lead_page_id, created_time desc);

alter table public.lead_pages enable row level security;
alter table public.leads enable row level security;

revoke all on table public.lead_pages from anon, authenticated;
revoke all on table public.leads from anon, authenticated;
grant select, insert, update on table public.lead_pages to service_role;
grant select, insert on table public.leads to service_role;

comment on table public.lead_pages is 'Links privados de acompanhamento de leads da Meta (Lead Ads). Acesso só pelo servidor.';
comment on table public.leads is 'Leads recebidos pelo webhook leadgen da Meta. Dados pessoais: acesso só pelo servidor.';
