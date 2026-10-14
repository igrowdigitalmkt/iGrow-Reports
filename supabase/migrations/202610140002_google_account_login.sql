-- Conta de gerente por conta de anúncios do Google: contas vinculadas a um gerente (MCC) usam o número dele no acesso;
-- contas com acesso direto do usuário conectado (sem gerente) ficam sem valor.
alter table public.google_ad_accounts add column login_customer_id text
  check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$');
