create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://bcrbjhdvqmqzrlkjrknp.supabase.co',
      'project_url',
      'Supabase project URL for DB → edge function calls'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'plant_analyze_hook_secret') then
    perform vault.create_secret(
      '<there was a long string of letters and numbers here>',
      'plant_analyze_hook_secret',
      'Bearer token for plants.photo_path → analyze-plant-photo trigger'
    );
  end if;
end $$;

create or replace function public.delete_plant_photo()
returns trigger
language plpgsql
security definer
set search_path = storage, public
as $$
begin
  delete from storage.objects
  where bucket_id = 'plant-photos'
    and (
      name = old.id::text
      or (old.photo_path is not null and name = old.photo_path)
      or name like old.id::text || '_%'
    );
  return old;
end;
$$;

create or replace function public.request_analyze_plant_photo()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  hook_secret text;
  request_id bigint;
begin
  if new.photo_path is null or btrim(new.photo_path) = '' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.photo_path is not distinct from new.photo_path then
    return new;
  end if;

  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into hook_secret
  from vault.decrypted_secrets
  where name = 'plant_analyze_hook_secret'
  limit 1;

  if project_url is null or hook_secret is null then
    raise warning 'request_analyze_plant_photo: missing vault secrets project_url / plant_analyze_hook_secret';
    return new;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/analyze-plant-photo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || hook_secret
    ),
    body := jsonb_build_object(
      'plant_id', new.id::text,
      'photo_path', new.photo_path
    )
  ) into request_id;

  return new;
end;
$$;

drop trigger if exists plants_analyze_photo on public.plants;

create trigger plants_analyze_photo
  after insert or update of photo_path on public.plants
  for each row
  execute function public.request_analyze_plant_photo();

revoke all on function public.request_analyze_plant_photo() from public;
revoke all on function public.request_analyze_plant_photo() from anon, authenticated;
grant execute on function public.request_analyze_plant_photo() to service_role;

comment on function public.request_analyze_plant_photo() is
  'Fires analyze-plant-photo edge function when plants.photo_path is written.';