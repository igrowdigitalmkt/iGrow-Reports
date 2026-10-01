-- Legacy accounts must be verified by synchronization/collection before validating
-- this constraint. New or updated active accounts require a Business Portfolio ID.
alter table public.meta_ad_accounts add constraint meta_ad_accounts_require_business
  check (archived_at is not null or business_id is not null) not valid;
