-- Origem de cada lead (campanha, conjunto, anúncio e plataforma), para filtrar leads por campanha e calcular o custo por lead.
-- Aditiva: só acrescenta colunas opcionais em `leads` (sem valor padrão obrigatório) e um índice. Nada é apagado nem reescrito.
-- Recuperação: as colunas podem ser descartadas sem afetar nenhum outro dado.

alter table public.leads
  add column if not exists campaign_name text check (campaign_name is null or char_length(campaign_name) <= 300),
  add column if not exists adset_name text check (adset_name is null or char_length(adset_name) <= 300),
  add column if not exists ad_name text check (ad_name is null or char_length(ad_name) <= 300),
  add column if not exists platform text check (platform is null or char_length(platform) <= 30),
  add column if not exists is_organic boolean;

create index if not exists leads_page_campaign_idx on public.leads (lead_page_id, campaign_id);

-- Leads já gravados recebem a origem na conferência com a Meta (só estas colunas, só quando ainda estão vazias).
grant update (campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, platform, is_organic) on table public.leads to service_role;
