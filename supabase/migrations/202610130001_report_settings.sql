-- Preferências de relatório por organização. Hoje só o layout do PDF: 'classic' (atual) ou 'modern' (novo, em A4).
-- Ausência de linha significa 'classic', então nada muda para quem não escolher.

create table public.report_settings (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  pdf_layout text not null default 'classic' check (pdf_layout in ('classic','modern')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.report_settings enable row level security;
revoke all on public.report_settings from public, anon, authenticated;
grant select, insert, update on public.report_settings to authenticated;
grant all on public.report_settings to service_role;

create policy report_settings_read on public.report_settings for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy report_settings_insert on public.report_settings for insert to authenticated
  with check (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));
create policy report_settings_update on public.report_settings for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]))
  with check (private.has_agency_role(agency_id, array['owner','admin']::public.agency_role[]));
