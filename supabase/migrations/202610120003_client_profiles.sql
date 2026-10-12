-- Perfil opcional do cliente: contexto de negócio que a IA usa para interpretar os números.
-- Nenhum campo é obrigatório e nenhum dado pessoal de contatos entra aqui.

create table public.client_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  segment text check (char_length(segment) <= 120),
  offering text check (char_length(offering) <= 500),
  location text check (char_length(location) <= 200),
  audience text check (char_length(audience) <= 500),
  ticket_range text check (char_length(ticket_range) <= 120),
  contact_flow text check (char_length(contact_flow) <= 300),
  goal text check (char_length(goal) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index client_profiles_agency_idx on public.client_profiles(agency_id);

alter table public.client_profiles enable row level security;
revoke all on public.client_profiles from public, anon, authenticated;
grant select, insert, update on public.client_profiles to authenticated;
grant all on public.client_profiles to service_role;

create policy client_profiles_read on public.client_profiles for select to authenticated
  using (private.agency_role(agency_id) is not null);
create policy client_profiles_insert on public.client_profiles for insert to authenticated
  with check (
    private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[])
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = client_profiles.agency_id)
  );
create policy client_profiles_update on public.client_profiles for update to authenticated
  using (private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[]))
  with check (
    private.has_agency_role(agency_id, array['owner','admin','editor']::public.agency_role[])
    and exists (select 1 from public.clients c where c.id = client_id and c.agency_id = client_profiles.agency_id)
  );
