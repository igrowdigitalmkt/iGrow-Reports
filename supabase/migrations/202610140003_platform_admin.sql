-- Super Admin (etapa 1): operadores da plataforma e trilha de auditoria administrativa.
-- Independente de agency_users: ser proprietário de uma organização NÃO concede acesso global.
-- Tudo vive no schema private, sem nenhum privilégio de tabela para anon/authenticated/service_role.
-- O acesso passa só por funções security definer, que exigem operador ativo (e MFA/aal2 nas
-- operações privilegiadas) lido do JWT verificado pelo Supabase, nunca de dados enviados pelo cliente.

create schema if not exists private;

create table private.platform_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('owner')),
  active boolean not null default true,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  check (active = (deactivated_at is null))
);

create table private.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null check (char_length(action) <= 80 and action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  resource_type text check (char_length(resource_type) <= 60),
  resource_id text check (char_length(resource_id) <= 120),
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048),
  created_at timestamptz not null default now()
);
create index platform_audit_log_created_idx on private.platform_audit_log(created_at desc);
create index platform_audit_log_actor_idx on private.platform_audit_log(actor_id, created_at desc);

alter table private.platform_operators enable row level security;
alter table private.platform_audit_log enable row level security;
revoke all on private.platform_operators, private.platform_audit_log from public, anon, authenticated, service_role;

-- A auditoria é append-only, mesmo para quem tem acesso direto ao banco por engano.
create function private.platform_audit_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'A auditoria da plataforma não pode ser alterada ou apagada.' using errcode = '42501';
end $$;
create trigger platform_audit_no_change before update or delete on private.platform_audit_log
  for each row execute function private.platform_audit_immutable();
create trigger platform_audit_no_truncate before truncate on private.platform_audit_log
  for each statement execute function private.platform_audit_immutable();

create function private.guard_platform_operator()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Operadores não são apagados; desative-os para manter o histórico.' using errcode = '42501';
  end if;
  if new.user_id <> old.user_id then
    raise exception 'A identidade do operador é imutável.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_platform_operator before update or delete on private.platform_operators
  for each row execute function private.guard_platform_operator();

-- Papel do operador ativo que fez a requisição, ou null. Com p_require_aal2, exige sessão MFA verificada.
create function private.platform_operator_role(p_require_aal2 boolean default true)
returns text language sql stable security definer set search_path = '' as $$
  select o.role from private.platform_operators o
  where o.user_id = auth.uid() and o.active
    and (not p_require_aal2 or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;
revoke all on function private.platform_operator_role(boolean) from public, anon, authenticated, service_role;

-- Estado do chamador: null para quem não é operador (não revela quem é). O aal vem do JWT verificado.
create function public.platform_operator_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := private.platform_operator_role(false);
begin
  if v_role is null then return null; end if;
  return jsonb_build_object('role', v_role, 'aal', coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1'));
end $$;

-- Operador sem MFA só registra eventos do próprio fluxo de MFA (evita poluir a trilha).
create function public.platform_record_audit(
  p_action text, p_resource_type text default null, p_resource_id text default null,
  p_outcome text default 'success', p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if private.platform_operator_role(false) is null then
    raise exception 'Acesso restrito aos operadores da plataforma.' using errcode = '42501';
  end if;
  if private.platform_operator_role(true) is null and p_action !~ '^admin\.mfa_[a-z_]+$' then
    raise exception 'Verificação em duas etapas necessária para esta operação.' using errcode = '42501';
  end if;
  -- Sem MFA o operador só registra eventos do próprio fluxo de MFA, com teto por hora (impede encher a trilha).
  if private.platform_operator_role(true) is null and
     (select count(*) from private.platform_audit_log where actor_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Muitas tentativas. Aguarde antes de tentar novamente.' using errcode = '54000';
  end if;
  insert into private.platform_audit_log(actor_id, action, resource_type, resource_id, outcome, metadata)
  values (auth.uid(), p_action, p_resource_type, p_resource_id, p_outcome, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create function public.platform_recent_audit(p_limit integer default 20)
returns table (id uuid, actor_email text, action text, resource_type text, resource_id text, outcome text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.platform_operator_role(true) is null then
    raise exception 'Acesso restrito aos operadores da plataforma com verificação em duas etapas.' using errcode = '42501';
  end if;
  return query
    select l.id, u.email::text, l.action, l.resource_type, l.resource_id, l.outcome, l.metadata, l.created_at
    from private.platform_audit_log l left join auth.users u on u.id = l.actor_id
    order by l.created_at desc, l.id
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;

revoke all on function public.platform_operator_status() from public, anon, service_role;
revoke all on function public.platform_record_audit(text, text, text, text, jsonb) from public, anon, service_role;
revoke all on function public.platform_recent_audit(integer) from public, anon, service_role;
grant execute on function public.platform_operator_status() to authenticated;
grant execute on function public.platform_record_audit(text, text, text, text, jsonb) to authenticated;
grant execute on function public.platform_recent_audit(integer) to authenticated;

-- Provisionamento do primeiro proprietário: SOMENTE por quem tem acesso direto ao banco (SQL Editor
-- do Supabase, papel postgres). Nenhum papel da API (anon, authenticated, service_role) pode executar.
-- Exige uma conta existente com e-mail confirmado e nenhum proprietário ativo.
create function private.provision_platform_owner(p_email text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid; v_confirmed timestamptz;
begin
  select id, email_confirmed_at into v_user, v_confirmed from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'Nenhuma conta com este e-mail. Crie a conta e confirme o e-mail antes de provisionar.' using errcode = '22023';
  end if;
  if v_confirmed is null then
    raise exception 'O e-mail desta conta ainda não foi confirmado.' using errcode = '22023';
  end if;
  if exists (select 1 from private.platform_operators where role = 'owner' and active) then
    raise exception 'Já existe um proprietário ativo da plataforma.' using errcode = '23514';
  end if;
  insert into private.platform_operators(user_id, role) values (v_user, 'owner')
  on conflict (user_id) do update set role = 'owner', active = true, deactivated_at = null;
  insert into private.platform_audit_log(actor_id, action, resource_type, resource_id, outcome)
  values (null, 'platform.owner_provisioned', 'platform_operator', v_user::text, 'success');
  return v_user;
end $$;

create function private.deactivate_platform_operator(p_user_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.platform_operators where user_id = p_user_id and active) then
    raise exception 'Operador ativo não encontrado.' using errcode = '22023';
  end if;
  if not exists (select 1 from private.platform_operators where user_id <> p_user_id and role = 'owner' and active) then
    raise exception 'A plataforma precisa manter pelo menos um proprietário ativo.' using errcode = '23514';
  end if;
  update private.platform_operators set active = false, deactivated_at = now() where user_id = p_user_id;
  insert into private.platform_audit_log(actor_id, action, resource_type, resource_id, outcome)
  values (null, 'platform.operator_deactivated', 'platform_operator', p_user_id::text, 'success');
end $$;

revoke all on function private.provision_platform_owner(text) from public, anon, authenticated, service_role;
revoke all on function private.deactivate_platform_operator(uuid) from public, anon, authenticated, service_role;
