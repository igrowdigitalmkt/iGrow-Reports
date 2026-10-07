-- Several official WhatsApp numbers per workspace, and schedules choose the sending number:
-- the QR Code session (free text) or one official number (approved template with the PDF).

alter table public.whatsapp_connections add column if not exists id uuid not null default gen_random_uuid();
alter table public.whatsapp_connections add column if not exists label text check (char_length(label) <= 60);
alter table public.whatsapp_connections add column if not exists coexistence boolean not null default false;
alter table public.whatsapp_connections drop constraint whatsapp_connections_pkey;
alter table public.whatsapp_connections add primary key (id);
alter table public.whatsapp_connections add constraint whatsapp_connections_agency_id_id_key unique (agency_id, id);
create index whatsapp_connections_agency_idx on public.whatsapp_connections(agency_id, created_at);

alter table public.report_automations add column sender text not null default 'qr' check (sender in ('qr','official'));
alter table public.report_automations add column whatsapp_connection_id uuid;
-- A removed number leaves the schedule without sender; the run is then skipped with an explanation.
alter table public.report_automations add constraint report_automations_whatsapp_connection_fkey
  foreign key (agency_id, whatsapp_connection_id) references public.whatsapp_connections(agency_id, id) on delete set null (whatsapp_connection_id);

-- Scheduled sends through an official number have no saved report version.
alter table public.report_deliveries alter column report_version_id drop not null;
alter table public.report_deliveries add column automation_run_id uuid references public.report_automation_runs(id) on delete set null;
alter table public.report_deliveries add column whatsapp_connection_id uuid references public.whatsapp_connections(id) on delete set null;
create index report_deliveries_run_idx on public.report_deliveries(automation_run_id) where automation_run_id is not null;

-- Removing a number also removes its stored credential.
create function public.delete_integration_secret(p_agency_id uuid, p_integration_id uuid, p_secret_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Operacao nao autorizada.' using errcode = '42501'; end if;
  delete from private.integration_secrets where agency_id = p_agency_id and integration_id = p_integration_id and secret_kind = p_secret_kind;
end $$;
revoke all on function public.delete_integration_secret(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_integration_secret(uuid, uuid, text) to service_role;
