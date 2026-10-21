-- Crédito informado manualmente para contas do Google Ads (Pix, boleto, pré-pago).
-- A API do Google Ads NÃO informa o crédito de pagamentos manuais (confirmado em 21/10/2026: orçamento da conta ilimitado, contas de
-- pagamento e faturas exigem nível de acesso maior). Este registro guarda o que o usuário depositou; o saldo mostrado na plataforma é
-- sempre uma ESTIMATIVA: créditos informados − gasto lido da API desde cada depósito.
--
-- Migração ADITIVA: cria uma tabela nova, sem tocar em nenhuma tabela existente. Nada é apagado: "remover" um crédito só marca
-- removed_at (histórico preservado). Recuperação: a tabela pode ser descartada sem afetar nenhum outro dado.

create table if not exists public.google_account_credits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  google_ad_account_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Dia em que o crédito passou a valer (o gasto só é descontado a partir daí, no calendário da conta).
  deposited_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  -- A conta precisa ser da mesma organização.
  constraint google_account_credits_account_fkey foreign key (agency_id, google_ad_account_id)
    references public.google_ad_accounts (agency_id, id) on delete restrict
);

create index if not exists google_account_credits_account_idx
  on public.google_account_credits (agency_id, google_ad_account_id, deposited_on)
  where removed_at is null;

alter table public.google_account_credits enable row level security;

-- Leitura para qualquer membro da organização (como as demais tabelas do Google Ads). Escritas só pelo servidor (service_role),
-- depois de conferir o papel do usuário (proprietário, administrador ou editor).
drop policy if exists google_account_credits_read on public.google_account_credits;
create policy google_account_credits_read on public.google_account_credits
  for select to authenticated using (private.agency_role(agency_id) is not null);

revoke all on table public.google_account_credits from anon, authenticated;
grant select on table public.google_account_credits to authenticated;
grant select, insert, update on table public.google_account_credits to service_role;

-- Valor, moeda, data e conta nunca mudam: o único update permitido é remover (uma vez) o crédito.
create or replace function private.google_account_credit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.removed_at is not null then
      raise exception 'Crédito já removido não pode ser alterado.' using errcode = '23514';
    end if;
    if new.id is distinct from old.id or new.agency_id is distinct from old.agency_id
       or new.google_ad_account_id is distinct from old.google_ad_account_id or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency or new.deposited_on is distinct from old.deposited_on
       or new.note is distinct from old.note or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'Só é permitido remover o crédito; os demais campos não mudam.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists google_account_credit_guard on public.google_account_credits;
create trigger google_account_credit_guard
  before update on public.google_account_credits
  for each row execute function private.google_account_credit_guard();

comment on table public.google_account_credits is
  'Créditos (depósitos) informados manualmente para contas do Google Ads. Base de uma estimativa de saldo; a API do Google não informa esse valor.';
