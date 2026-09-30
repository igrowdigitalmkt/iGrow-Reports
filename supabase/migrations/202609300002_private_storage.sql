insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('agency-assets','agency-assets',false,5242880,array['image/png','image/jpeg','image/webp']),
  ('client-assets','client-assets',false,5242880,array['image/png','image/jpeg','image/webp']),
  ('report-assets','report-assets',false,20971520,array['image/png','image/jpeg','image/webp']),
  ('report-pdfs','report-pdfs',false,20971520,array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths: agency-assets/<agency UUID>/<file>; client-assets/<agency UUID>/<client UUID>/<file>.
-- report-* are reserved for future jobs; clients receive no direct write policy.
create function private.can_access_asset(p_bucket text, p_name text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_agency_id uuid; v_client_id uuid; v_role public.agency_role;
begin
  if p_bucket not in ('agency-assets','client-assets','report-assets','report-pdfs') then return false; end if;
  if p_name is null or p_name like '%..%' or split_part(p_name,'/',2) = '' then return false; end if;
  begin
    v_agency_id := split_part(p_name,'/',1)::uuid;
  exception when invalid_text_representation then return false;
  end;
  v_role := private.agency_role(v_agency_id);
  if v_role is null then return false; end if;
  if p_bucket = 'client-assets' then
    begin
      v_client_id := split_part(p_name,'/',2)::uuid;
    exception when invalid_text_representation then return false;
    end;
    if split_part(p_name,'/',3) = '' or not exists (
      select 1 from public.clients where agency_id = v_agency_id and id = v_client_id
    ) then return false; end if;
  end if;
  if not p_write then return true; end if;
  if p_bucket = 'agency-assets' then return v_role in ('owner','admin'); end if;
  if p_bucket = 'client-assets' then return v_role in ('owner','admin','editor'); end if;
  return false;
end;
$$;
revoke all on function private.can_access_asset(text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function private.can_access_asset(text,text,boolean) to authenticated;

create policy igrow_assets_read on storage.objects for select to authenticated
  using (private.can_access_asset(bucket_id,name,false));
create policy igrow_assets_insert on storage.objects for insert to authenticated
  with check (private.can_access_asset(bucket_id,name,true));
create policy igrow_assets_update on storage.objects for update to authenticated
  using (private.can_access_asset(bucket_id,name,true))
  with check (private.can_access_asset(bucket_id,name,true));
create policy igrow_assets_delete on storage.objects for delete to authenticated
  using (private.can_access_asset(bucket_id,name,true));
