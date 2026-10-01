-- Existing accounts are verified against the Graph API during their next collection.
-- No business ID is inferred from a name or from an agency's portfolio.
alter table public.meta_ad_accounts add column if not exists business_id text;
alter table public.meta_ad_accounts add constraint meta_ad_accounts_business_id_format
  check (business_id is null or business_id ~ '^[0-9]+$');
