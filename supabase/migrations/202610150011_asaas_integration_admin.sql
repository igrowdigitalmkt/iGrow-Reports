-- Etapa 2.2H: integração com o Asaas administrada pelo Super Admin (Integrações > Pagamentos), sem alterar código nem variáveis da Vercel.
-- Aditiva: 1 tabela de ESTADO (sem segredos), 6 funções administrativas (operador + MFA, auditadas) e 1 função só do servidor.
--  - A chave de API e os tokens do webhook ficam no Supabase Vault (criptografados em repouso). Nenhuma tabela comum guarda segredo; nenhuma
--    função administrativa devolve segredo; a única leitura dos segredos é asaas_read_credentials(), concedida SOMENTE ao service_role.
--  - Trocar de conta Asaas é recusado quando há registros financeiros do ambiente (assinaturas, pagamentos, contratações, clientes reais,
--    eventos não resolvidos): é preciso um procedimento de migração, nunca automático.
--  - Rotação do token do webhook com transição: o token anterior continua válido por um prazo curto e depois deixa de valer.
--  - NÃO altera billing_settings.live_enabled e não libera cobrança: registrar credenciais não habilita contratação real.

create table private.asaas_integration (
  id boolean primary key default true check (id),
  environment text check (environment in ('sandbox', 'production')),
  api_key_secret_id uuid,
  key_changed_at timestamptz,
  key_status text not null default 'unverified' check (key_status in ('unverified', 'connected', 'auth_failed', 'unreachable')),
  key_checked_at timestamptz,
  -- Impressão digital (SHA-256) da identidade da conta Asaas por ambiente; não é segredo e não permite reconstruir o identificador.
  sandbox_fingerprint text,
  production_fingerprint text,
  webhook_token_secret_id uuid,
  webhook_token_changed_at timestamptz,
  webhook_prev_secret_id uuid,
  webhook_prev_expires_at timestamptz,
  webhook_status text not null default 'unknown' check (webhook_status in ('unknown', 'ok', 'missing', 'disabled', 'interrupted', 'no_token', 'incomplete_events', 'duplicate', 'unreachable', 'auth_failed')),
  webhook_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.asaas_integration default values;
alter table private.asaas_integration enable row level security;
revoke all on private.asaas_integration from public, anon, authenticated, service_role;

-- Registros financeiros ligados ao ambiente (indicam que existe uma conta Asaas "em uso"). Clientes sintéticos (testes) não contam.
create function private.asaas_financial_links(p_environment text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subscriptions', (select count(*) from private.billing_subscriptions where environment = p_environment),
    'payments', (select count(*) from private.billing_payments where environment = p_environment),
    'checkouts', (select count(*) from private.billing_checkout_intents where environment = p_environment),
    'customers', (select count(*) from private.billing_customers where environment = p_environment and not synthetic),
    'open_events', (select count(*) from private.billing_events where environment = p_environment and status in ('received', 'processing', 'failed', 'needs_review')));
$$;
revoke all on function private.asaas_financial_links(text) from public, anon, authenticated, service_role;

create function private.asaas_key_problem(p_environment text, p_key text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_environment not in ('sandbox', 'production') then 'Escolha o ambiente (Sandbox ou Produção).'
    when p_key is null or length(p_key) < 20 or length(p_key) > 400 or p_key ~ '\s' then 'Chave de API em formato inválido.'
    when p_environment = 'production' and p_key not like '$aact\_prod\_%' then 'Em Produção, a chave precisa ser uma chave de produção do Asaas.'
    when p_environment = 'sandbox' and p_key like '$aact\_prod\_%' then 'Chave de produção não pode ser usada no ambiente Sandbox.'
    else null end;
$$;
revoke all on function private.asaas_key_problem(text, text) from public, anon, authenticated, service_role;

-- ESTADO (sem segredos): o que a tela mostra.
create function public.platform_asaas_get_state(p_environment text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i private.asaas_integration; links jsonb; env text;
begin
  perform private.require_operator();
  if p_environment not in ('sandbox', 'production') then raise exception 'Ambiente inválido.' using errcode = '22023'; end if;
  select * into i from private.asaas_integration;
  env := coalesce(i.environment, p_environment);
  links := private.asaas_financial_links(env);
  return jsonb_build_object(
    'managed', i.api_key_secret_id is not null,
    'environment', i.environment,
    'key_configured', i.api_key_secret_id is not null,
    'key_changed_at', i.key_changed_at, 'key_status', i.key_status, 'key_checked_at', i.key_checked_at,
    'account_registered', case env when 'production' then i.production_fingerprint is not null else i.sandbox_fingerprint is not null end,
    'webhook_token_configured', i.webhook_token_secret_id is not null, 'webhook_token_changed_at', i.webhook_token_changed_at,
    'previous_token_active', i.webhook_prev_expires_at is not null and i.webhook_prev_expires_at > now(), 'previous_token_expires_at', case when i.webhook_prev_expires_at > now() then i.webhook_prev_expires_at end,
    'webhook_status', i.webhook_status, 'webhook_checked_at', i.webhook_checked_at,
    'live_enabled', (select live_enabled from private.billing_settings),
    'links', links,
    'last_event_at', (select max(received_at) from private.billing_events where environment = env),
    'events', (select jsonb_build_object('failed', count(*) filter (where status = 'failed'), 'needs_review', count(*) filter (where status = 'needs_review'),
        'pending', count(*) filter (where status in ('received', 'processing'))) from private.billing_events where environment = env),
    'cron', public.billing_cron_health(env));
end $$;

-- Registra/substitui a chave. A validação na API do Asaas é feita pelo servidor ANTES desta chamada (a impressão digital da conta vem dela).
create function public.platform_asaas_save_key(p_environment text, p_api_key text, p_account_fingerprint text, p_confirm_same_account boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare i private.asaas_integration; problem text; links jsonb; total bigint; known text; secret_id uuid;
begin
  perform private.require_operator();
  problem := private.asaas_key_problem(p_environment, p_api_key);
  if problem is not null then raise exception '%', problem using errcode = '22023'; end if;
  if p_account_fingerprint is null or p_account_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'Não foi possível identificar a conta Asaas desta chave.' using errcode = '22023'; end if;
  select * into i from private.asaas_integration for update;
  known := case p_environment when 'production' then i.production_fingerprint else i.sandbox_fingerprint end;
  links := private.asaas_financial_links(p_environment);
  select coalesce(sum(value::bigint), 0) into total from jsonb_each_text(links);
  if known is distinct from p_account_fingerprint and total > 0 then
    if known is not null then
      raise exception 'Esta chave pertence a OUTRA conta Asaas e já existem assinaturas, pagamentos, contratações ou eventos vinculados à conta atual. Trocar de conta exige um procedimento de migração e não é feito por esta tela.' using errcode = '22023';
    elsif not coalesce(p_confirm_same_account, false) then
      raise exception 'Já existem registros financeiros deste ambiente e a conta atual ainda não foi registrada. Confirme que a chave pertence à MESMA conta Asaas que os criou.' using errcode = '22023';
    end if;
  end if;
  if i.api_key_secret_id is null then
    secret_id := vault.create_secret(p_api_key, 'igrow_asaas_api_key', 'Chave de API do Asaas (gerenciada pelo Super Admin)');
  else
    secret_id := i.api_key_secret_id;
    perform vault.update_secret(secret_id, p_api_key);
  end if;
  update private.asaas_integration set environment = p_environment, api_key_secret_id = secret_id, key_changed_at = now(), key_status = 'connected', key_checked_at = now(),
    sandbox_fingerprint = case when p_environment = 'sandbox' then p_account_fingerprint else sandbox_fingerprint end,
    production_fingerprint = case when p_environment = 'production' then p_account_fingerprint else production_fingerprint end,
    webhook_status = case when i.environment is distinct from p_environment or known is distinct from p_account_fingerprint then 'unknown' else webhook_status end,
    updated_at = now() where id;
  perform private.audit_platform('integration.asaas_key_saved', 'asaas_integration', 'asaas',
    jsonb_build_object('environment', array_to_json(array[i.environment, p_environment]), 'first_key', i.api_key_secret_id is null, 'same_account', known is not distinct from p_account_fingerprint,
      'financial_records', total));
end $$;

-- Gira o token do webhook. O token novo é gerado pelo servidor e exibido uma única vez; aqui só é guardado. O anterior vale por p_grace_minutes.
create function public.platform_asaas_rotate_webhook_token(p_token text, p_grace_minutes integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare i private.asaas_integration; old_token text; new_id uuid; prev_id uuid; prev_expires timestamptz;
begin
  perform private.require_operator();
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,255}$' then raise exception 'Token do webhook em formato inválido.' using errcode = '22023'; end if;
  if p_grace_minutes is null or p_grace_minutes not between 0 and 1440 then raise exception 'A transição do token anterior vai de 0 a 1440 minutos.' using errcode = '22023'; end if;
  select * into i from private.asaas_integration for update;
  if i.api_key_secret_id is not null and exists (select 1 from vault.decrypted_secrets where id = i.api_key_secret_id and decrypted_secret = p_token) then
    raise exception 'O token do webhook não pode ser igual à chave de API.' using errcode = '22023';
  end if;
  prev_id := i.webhook_prev_secret_id; prev_expires := null;
  if i.webhook_token_secret_id is null then
    new_id := vault.create_secret(p_token, 'igrow_asaas_webhook_token', 'Token do webhook do Asaas (gerenciado pelo Super Admin)');
  else
    new_id := i.webhook_token_secret_id;
    select decrypted_secret into old_token from vault.decrypted_secrets where id = new_id;
    if p_grace_minutes > 0 and old_token is not null then
      if prev_id is null then prev_id := vault.create_secret(old_token, 'igrow_asaas_webhook_token_previous', 'Token anterior do webhook (em transição)');
      else perform vault.update_secret(prev_id, old_token); end if;
      prev_expires := now() + make_interval(mins => p_grace_minutes);
    elsif prev_id is not null then
      perform vault.update_secret(prev_id, gen_random_uuid()::text); -- sem transição: o anterior é inutilizado
    end if;
    perform vault.update_secret(new_id, p_token);
  end if;
  update private.asaas_integration set webhook_token_secret_id = new_id, webhook_token_changed_at = now(), webhook_prev_secret_id = prev_id, webhook_prev_expires_at = prev_expires,
    webhook_status = 'unknown', updated_at = now() where id;
  perform private.audit_platform('integration.asaas_webhook_token_rotated', 'asaas_integration', 'asaas', jsonb_build_object('grace_minutes', p_grace_minutes, 'first_token', i.webhook_token_secret_id is null));
end $$;

-- Encerra a transição agora: o token anterior deixa de valer imediatamente.
create function public.platform_asaas_revoke_previous_token()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare i private.asaas_integration;
begin
  perform private.require_operator();
  select * into i from private.asaas_integration for update;
  if i.webhook_prev_secret_id is not null then perform vault.update_secret(i.webhook_prev_secret_id, gen_random_uuid()::text); end if;
  update private.asaas_integration set webhook_prev_expires_at = null, updated_at = now() where id;
  perform private.audit_platform('integration.asaas_previous_token_revoked', 'asaas_integration', 'asaas', '{}'::jsonb);
end $$;

-- Resultado de uma verificação feita pelo servidor (teste de conexão ou conferência do webhook). Sem dados sensíveis.
create function public.platform_asaas_record_check(p_kind text, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.require_operator();
  if p_kind = 'connection' then
    if p_status not in ('connected', 'auth_failed', 'unreachable') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
    update private.asaas_integration set key_status = p_status, key_checked_at = now(), updated_at = now() where id and api_key_secret_id is not null;
  elsif p_kind = 'webhook' then
    if p_status not in ('ok', 'missing', 'disabled', 'interrupted', 'no_token', 'incomplete_events', 'duplicate', 'unreachable', 'auth_failed') then raise exception 'Resultado inválido.' using errcode = '22023'; end if;
    update private.asaas_integration set webhook_status = p_status, webhook_checked_at = now(), updated_at = now() where id;
  else
    raise exception 'Verificação inválida.' using errcode = '22023';
  end if;
  perform private.audit_platform('integration.asaas_' || p_kind || '_checked', 'asaas_integration', 'asaas', jsonb_build_object('result', p_status));
end $$;

-- ÚNICA leitura dos segredos: somente o servidor (service_role). Devolve nulo para o que não estiver configurado; o token anterior só enquanto a transição valer.
create function public.asaas_read_credentials()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i private.asaas_integration;
begin
  select * into i from private.asaas_integration;
  if i.api_key_secret_id is null then return jsonb_build_object('managed', false); end if;
  return jsonb_build_object(
    'managed', true, 'environment', i.environment,
    'api_key', (select decrypted_secret from vault.decrypted_secrets where id = i.api_key_secret_id),
    'webhook_token', (select decrypted_secret from vault.decrypted_secrets where id = i.webhook_token_secret_id),
    'webhook_token_previous', case when i.webhook_prev_expires_at > now() then (select decrypted_secret from vault.decrypted_secrets where id = i.webhook_prev_secret_id) end);
end $$;

revoke all on function public.platform_asaas_get_state(text), public.platform_asaas_save_key(text, text, text, boolean), public.platform_asaas_rotate_webhook_token(text, integer),
  public.platform_asaas_revoke_previous_token(), public.platform_asaas_record_check(text, text), public.asaas_read_credentials() from public, anon, authenticated, service_role;
grant execute on function public.platform_asaas_get_state(text), public.platform_asaas_save_key(text, text, text, boolean), public.platform_asaas_rotate_webhook_token(text, integer),
  public.platform_asaas_revoke_previous_token(), public.platform_asaas_record_check(text, text) to authenticated;
grant execute on function public.asaas_read_credentials() to service_role;
