-- Flower ratio (flowers per cm² of leaf area) and pollen per flower are
-- constants corrected by each new photo. An hourly job refreshes flower
-- count from current leaf area and credits pollen every 8 hours.

alter table public.plants
  add column if not exists flower_ratio double precision,
  add column if not exists pollen_per_flower_cm3 double precision,
  add column if not exists flower_count double precision,
  add column if not exists flower_count_updated_at timestamptz,
  add column if not exists last_pollen_credited_at timestamptz;

comment on column public.plants.flower_ratio is
  'Flowers per cm² of leaf area. Corrected when a new photo is taken.';
comment on column public.plants.pollen_per_flower_cm3 is
  'Cubic centimeters of pollen one flower produces over 8 hours.';
comment on column public.plants.flower_count is
  'Latest flower count: flower_ratio times current leaf area. Refreshed hourly.';
comment on column public.plants.last_pollen_credited_at is
  'When this plant last added generated pollen to the owner balance.';

alter table public.plant_health_info
  add column if not exists flower_ratio double precision,
  add column if not exists pollen_per_flower_cm3 double precision;

create or replace function public.credit_user_pollen(target_user_id uuid, amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if amount is null or amount <= 0 then
    select pollen into new_balance from public.user_currency where user_id = target_user_id;
    return coalesce(new_balance, 0);
  end if;

  insert into public.user_currency (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;

  update public.user_currency
  set pollen = pollen + amount,
      updated_at = now()
  where user_id = target_user_id
  returning pollen into new_balance;

  return new_balance;
end;
$$;

revoke all on function public.credit_user_pollen(uuid, numeric) from public;
revoke all on function public.credit_user_pollen(uuid, numeric) from anon, authenticated;
grant execute on function public.credit_user_pollen(uuid, numeric) to service_role;

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pollen_accrual_secret') then
    perform vault.create_secret(
      'kR7mQ2vL9pX4nW8sT1cY6bH3dF5aJ0eU',
      'pollen_accrual_secret',
      'Bearer token for the hourly accrue-pollen edge function'
    );
  end if;
end $$;

create or replace function public.invoke_accrue_pollen()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'pollen_accrual_secret'
  limit 1;

  if project_url is null or secret is null then
    raise warning 'invoke_accrue_pollen: missing vault secrets';
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/accrue-pollen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_accrue_pollen() from public;
revoke all on function public.invoke_accrue_pollen() from anon, authenticated;
grant execute on function public.invoke_accrue_pollen() to service_role;

do $$
declare
  existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'accrue-pollen-hourly';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'accrue-pollen-hourly',
    '0 * * * *',
    'select public.invoke_accrue_pollen()'
  );
end $$;
