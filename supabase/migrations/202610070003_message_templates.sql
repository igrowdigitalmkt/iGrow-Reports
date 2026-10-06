-- Message templates saved by the agency (the platform's ready-made ones live in the code),
-- and the origin of each automation run: on schedule or "Enviar agora".

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  segment text not null default 'geral' check (segment in ('geral','mensagens','vendas','leads','seguidores','trafego','reconhecimento')),
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);
create index message_templates_agency_idx on public.message_templates(agency_id, updated_at desc);

alter table public.message_templates enable row level security;
revoke all on public.message_templates from public, anon, authenticated;
grant select, insert, update, delete on public.message_templates to authenticated;
grant all on public.message_templates to service_role;
create policy message_templates_read on public.message_templates for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy message_templates_write on public.message_templates for all to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]));

alter table public.report_automation_runs add column trigger text not null default 'schedule' check (trigger in ('schedule','manual'));
