-- Hourly oxygen accrual. The bearer secret is Vault secret 'accrue_oxygen_secret'
-- and must match the accrue-oxygen function's ACCRUE_SECRET. It is not stored here.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.request_accrue_oxygen()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  accrue_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into accrue_secret
  from vault.decrypted_secrets
  where name = 'accrue_oxygen_secret'
  limit 1;

  if project_url is null or accrue_secret is null then
    raise warning 'request_accrue_oxygen: missing vault secrets project_url / accrue_oxygen_secret';
    return;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/accrue-oxygen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || accrue_secret
    ),
    body := '{}'::jsonb
  ) into request_id;
end;
$$;

revoke all on function public.request_accrue_oxygen() from public;
revoke all on function public.request_accrue_oxygen() from anon, authenticated;
grant execute on function public.request_accrue_oxygen() to service_role;

comment on function public.request_accrue_oxygen() is
  'Calls the accrue-oxygen edge function with the Vault-stored bearer secret. Scheduled hourly via pg_cron.';

do $$
declare
  existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'accrue-oxygen-hourly';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'accrue-oxygen-hourly',
    '0 * * * *',
    'select public.request_accrue_oxygen()'
  );
end $$;
