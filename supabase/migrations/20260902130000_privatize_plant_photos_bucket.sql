update storage.buckets
set public = false
where id = 'plant-photos';

drop policy if exists "Public read plant photos" on storage.objects;

drop policy if exists "Users can read their own plant photos" on storage.objects;

create policy "Users can read their own plant photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plant-photos'
    and exists (
      select 1
      from public.plants p
      where p.id::text = name
        and p.user_id = auth.uid()
    )
  );
