-- Leads por WhatsApp (etapa 3a): sessão de captação por cliente (QR Code, instância própria do Evolution).
-- Aditiva: uma tabela nova, só do servidor. Não toca na caixa do WhatsApp da agência nem em leads existentes.
-- Dados pessoais futuros ficarão em `leads`; esta tabela guarda só configuração e o último sinal da sessão.

create table if not exists public.lead_whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete restrict,
  client_id uuid not null,
  -- all = todo contato novo vira lead; ads = só conversa vinda de anúncio; manual = só quando alguém marcar.
  qualify_mode text not null default 'all' check (qualify_mode in ('all', 'ads', 'manual')),
  -- Telefones (só dígitos, com DDI) que nunca viram lead: equipe, fornecedores, o próprio número.
  ignored_numbers text[] not null default '{}' check (cardinality(ignored_numbers) <= 200),
  active boolean not null default true,
  connected_phone text check (connected_phone is null or char_length(connected_phone) <= 40),
  last_event_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_whatsapp_sessions_client_fkey foreign key (agency_id, client_id) references public.clients (agency_id, id) on delete restrict,
  -- Primeira versão: um número por cliente.
  constraint lead_whatsapp_sessions_one_per_client unique (agency_id, client_id)
);

alter table public.lead_whatsapp_sessions enable row level security;
revoke all on public.lead_whatsapp_sessions from public, anon, authenticated;
grant all on public.lead_whatsapp_sessions to service_role;
