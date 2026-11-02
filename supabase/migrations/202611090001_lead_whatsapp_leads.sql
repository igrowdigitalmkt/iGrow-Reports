-- Leads por WhatsApp (etapa 3b): a sessão de captação passa a ter uma fonte em `lead_pages` e o lead guarda a primeira mensagem.
-- Aditiva: colunas novas com valor padrão e uma restrição que as linhas existentes (todas Páginas do Facebook) já cumprem.
-- Recuperação: as colunas e o índice novos podem ser descartados sem afetar nenhum outro dado.

alter table public.lead_pages
  add column if not exists kind text not null default 'facebook' check (kind in ('facebook', 'whatsapp')),
  add column if not exists wa_session_id uuid references public.lead_whatsapp_sessions (id) on delete restrict;

-- Fonte de WhatsApp não tem Página do Facebook.
alter table public.lead_pages alter column fb_page_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lead_pages_kind_shape' and conrelid = 'public.lead_pages'::regclass
  ) then
    alter table public.lead_pages add constraint lead_pages_kind_shape check (
      (kind = 'facebook' and fb_page_id is not null and wa_session_id is null)
      or (kind = 'whatsapp' and fb_page_id is null and wa_session_id is not null)
    );
  end if;
end
$$;

create unique index if not exists lead_pages_wa_session_idx
  on public.lead_pages (wa_session_id) where wa_session_id is not null;

alter table public.leads
  add column if not exists first_message text check (first_message is null or char_length(first_message) <= 300);
