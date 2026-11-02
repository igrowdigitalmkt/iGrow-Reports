-- Alertas de lead novo por WhatsApp: quem recebe, quais campanhas/formulários, se é na hora ou em horários fixos, e o registro de envios.
-- Aditiva: duas tabelas novas, sem tocar nas existentes. Recuperação: as tabelas podem ser descartadas sem afetar nenhum outro dado.
-- São dados pessoais (telefones): acesso só pelo servidor (service_role), sem política para anon/authenticated.

create table if not exists public.lead_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete restrict,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  -- E.164 (ex.: +5591980748371).
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- instant: um aviso por lead, na hora. scheduled: resumo nos horários de send_times (nos dias de weekdays).
  mode text not null default 'instant' check (mode in ('instant', 'scheduled')),
  send_times text[] not null default '{}' check (cardinality(send_times) <= 12),
  weekdays smallint[] not null default '{0,1,2,3,4,5,6}' check (cardinality(weekdays) between 1 and 7),
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 3 and 64),
  -- null = todas as campanhas / todos os formulários do cliente.
  campaign_ids text[] check (campaign_ids is null or cardinality(campaign_ids) <= 100),
  form_ids text[] check (form_ids is null or cardinality(form_ids) <= 100),
  active boolean not null default true,
  -- Quem cadastrou confirma que a pessoa concordou em receber os avisos.
  consent_confirmed_at timestamptz not null,
  consent_by uuid references auth.users (id) on delete set null,
  -- Preenchido quando a pessoa responde PARAR ao número da Groow.
  opted_out_at timestamptz,
  removed_at timestamptz,
  -- Resumos: leads novos desde esta data (ou desde o cadastro, se vazia).
  last_digest_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_alert_recipients_client_fkey foreign key (agency_id, client_id)
    references public.clients (agency_id, id) on delete restrict
);
create index if not exists lead_alert_recipients_client_idx on public.lead_alert_recipients (client_id) where removed_at is null;
create index if not exists lead_alert_recipients_phone_idx on public.lead_alert_recipients (agency_id, phone);

create table if not exists public.lead_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.lead_alert_recipients (id) on delete restrict,
  lead_id uuid references public.leads (id) on delete restrict,
  kind text not null check (kind in ('instant', 'digest', 'test')),
  -- Resumo: o horário do envio (ex.: 2026-11-05 09:00), único por pessoa.
  slot text check (slot is null or char_length(slot) <= 40),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text check (error is null or char_length(error) <= 300),
  lead_count integer not null default 0 check (lead_count >= 0),
  created_at timestamptz not null default now()
);
-- Cada lead gera no máximo um aviso instantâneo por pessoa, e cada horário um único resumo (mesmo se o aviso da Meta ou o agendador repetirem).
create unique index if not exists lead_alert_instant_once on public.lead_alert_deliveries (recipient_id, lead_id) where kind = 'instant';
create unique index if not exists lead_alert_digest_once on public.lead_alert_deliveries (recipient_id, slot) where kind = 'digest';
create index if not exists lead_alert_deliveries_recipient_idx on public.lead_alert_deliveries (recipient_id, created_at desc);

alter table public.lead_alert_recipients enable row level security;
alter table public.lead_alert_deliveries enable row level security;

revoke all on table public.lead_alert_recipients, public.lead_alert_deliveries from anon, authenticated;
grant select, insert, update on table public.lead_alert_recipients to service_role;
grant select, insert, update on table public.lead_alert_deliveries to service_role;

comment on table public.lead_alert_recipients is 'Pessoas que recebem alerta de lead novo por WhatsApp (por cliente). Dados pessoais: acesso só pelo servidor.';
comment on table public.lead_alert_deliveries is 'Registro de cada alerta de lead enviado (ou que falhou). Garante um aviso por lead e um resumo por horário.';
