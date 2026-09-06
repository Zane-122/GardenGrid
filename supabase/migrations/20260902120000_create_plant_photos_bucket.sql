insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plant-photos',
  'plant-photos',
  false,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

comment on table public.plants is 'User-owned plant instances. Photo objects live in storage bucket plant-photos named with plants.id.';

alter table public.plants
  add column if not exists photo_path text;

comment on column public.plants.photo_path is
  'Object name in the plant-photos bucket. Equals plants.id when this instance was added from a user photo.';

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

create policy "Users can delete their own plant photos"
  on storage.objects
  for delete
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

create or replace function public.delete_plant_photo()
returns trigger
language plpgsql
security definer
set search_path = storage, public
as $$
begin
  delete from storage.objects
  where bucket_id = 'plant-photos'
    and name = old.id::text;
  return old;
end;
$$;

drop trigger if exists plants_delete_photo on public.plants;

create trigger plants_delete_photo
  before delete on public.plants
  for each row
  execute function public.delete_plant_photo();
