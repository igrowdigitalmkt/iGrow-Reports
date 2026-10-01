-- Administrative operations for the authenticated Client Area.
-- Auth user lookup stays inside SECURITY DEFINER RPCs; auth.users is never exposed.

create function public.list_agency_client_portal_accesses(p_agency_id uuid)
returns table(
  client_id uuid,
  user_id uuid,
  email text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para consultar acessos da Área do Cliente.' using errcode = '42501';
  end if;

  return query
    select cu.client_id, cu.user_id, lower(u.email), cu.active, cu.created_at, cu.updated_at
    from public.client_users cu
    join auth.users u on u.id = cu.user_id
    where cu.agency_id = p_agency_id
    order by cu.client_id, cu.active desc, lower(u.email), cu.user_id;
end;
$$;

create function public.set_client_user_access_by_email(
  p_agency_id uuid,
  p_client_id uuid,
  p_email text,
  p_active boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_email text;
begin
  if not private.has_agency_role(
    p_agency_id, array['owner','admin']::public.agency_role[]
  ) then
    raise exception 'Sem permissão para gerenciar a Área do Cliente.' using errcode = '42501';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if char_length(v_email) not between 3 and 254 or v_email not like '%@%' or p_active is null then
    raise exception 'Email ou estado de acesso inválido.' using errcode = '22023';
  end if;

  if p_active then
    select id into v_user_id
    from auth.users
    where lower(email) = v_email and email_confirmed_at is not null;
  else
    select u.id into v_user_id
    from public.client_users cu
    join auth.users u on u.id = cu.user_id
    where cu.agency_id = p_agency_id
      and cu.client_id = p_client_id
      and lower(u.email) = v_email;
  end if;

  if v_user_id is null then
    raise exception 'Conta autenticada e confirmada indisponível.' using errcode = '22023';
  end if;

  perform public.set_client_user_access(
    p_agency_id,
    p_client_id,
    v_user_id,
    p_active
  );

  return v_user_id;
end;
$$;

revoke all on function public.list_agency_client_portal_accesses(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_agency_client_portal_accesses(uuid)
  to authenticated;

revoke all on function public.set_client_user_access_by_email(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_client_user_access_by_email(uuid, uuid, text, boolean)
  to authenticated;
