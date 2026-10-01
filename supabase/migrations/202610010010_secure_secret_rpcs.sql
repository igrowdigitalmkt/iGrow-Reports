-- Access encrypted integration secrets through service-role-only RPCs.
-- The private schema remains hidden from PostgREST clients.

create or replace function public.upsert_integration_secret(
  p_agency_id uuid,
  p_integration_id uuid,
  p_secret_kind text,
  p_key_id text,
  p_nonce_b64 text,
  p_ciphertext_b64 text,
  p_auth_tag_b64 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao nao autorizada.' using errcode = '42501';
  end if;

  insert into private.integration_secrets(
    agency_id,
    integration_id,
    secret_kind,
    key_id,
    nonce_b64,
    ciphertext_b64,
    auth_tag_b64,
    updated_at
  )
  values(
    p_agency_id,
    p_integration_id,
    p_secret_kind,
    p_key_id,
    p_nonce_b64,
    p_ciphertext_b64,
    p_auth_tag_b64,
    now()
  )
  on conflict (integration_id, secret_kind)
  do update set
    agency_id = excluded.agency_id,
    key_id = excluded.key_id,
    nonce_b64 = excluded.nonce_b64,
    ciphertext_b64 = excluded.ciphertext_b64,
    auth_tag_b64 = excluded.auth_tag_b64,
    updated_at = now();
end;
$$;

revoke all on function public.upsert_integration_secret(uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.upsert_integration_secret(uuid,uuid,text,text,text,text,text)
  to service_role;

create or replace function public.get_integration_secret(
  p_agency_id uuid,
  p_integration_id uuid,
  p_secret_kind text
)
returns table(
  key_id text,
  nonce_b64 text,
  ciphertext_b64 text,
  auth_tag_b64 text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operacao nao autorizada.' using errcode = '42501';
  end if;

  return query
  select
    s.key_id,
    s.nonce_b64,
    s.ciphertext_b64,
    s.auth_tag_b64
  from private.integration_secrets s
  where s.agency_id = p_agency_id
    and s.integration_id = p_integration_id
    and s.secret_kind = p_secret_kind
  limit 1;
end;
$$;

revoke all on function public.get_integration_secret(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_integration_secret(uuid,uuid,text)
  to service_role;
