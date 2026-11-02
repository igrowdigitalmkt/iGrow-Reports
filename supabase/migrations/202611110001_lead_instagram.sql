-- Leads pelo Instagram Direct (etapa 4): fonte própria por conta profissional do Instagram e o @ do contato no lead.
-- Aditiva e executada numa transação. As linhas existentes (Páginas do Facebook e WhatsApp) já cumprem as restrições novas.
-- Recuperação: as colunas e o índice novos podem ser descartados; a restrição antiga pode ser recriada sem o ramo 'instagram'.

alter table public.lead_pages
  add column if not exists ig_account_id text check (ig_account_id is null or ig_account_id ~ '^[0-9]{5,30}$'),
  add column if not exists ig_username text check (ig_username is null or char_length(ig_username) <= 100);

alter table public.lead_pages drop constraint if exists lead_pages_kind_check;
alter table public.lead_pages add constraint lead_pages_kind_check check (kind in ('facebook', 'whatsapp', 'instagram'));

alter table public.lead_pages drop constraint if exists lead_pages_kind_shape;
alter table public.lead_pages add constraint lead_pages_kind_shape check (
  (kind = 'facebook' and fb_page_id is not null and wa_session_id is null and ig_account_id is null)
  or (kind = 'whatsapp' and fb_page_id is null and wa_session_id is not null and ig_account_id is null)
  or (kind = 'instagram' and fb_page_id is not null and ig_account_id is not null and wa_session_id is null)
);

-- Uma conta do Instagram pertence a uma única fonte.
create unique index if not exists lead_pages_ig_account_idx
  on public.lead_pages (ig_account_id) where kind = 'instagram';

-- @ (usuário) do contato no Instagram; leads do Instagram não têm telefone.
alter table public.leads
  add column if not exists handle text check (handle is null or char_length(handle) <= 100);
