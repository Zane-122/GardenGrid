-- NOT applied yet. Lives in supabase/pending/ so `supabase db push` ignores it.
-- Before moving it into supabase/migrations/:
--   1. Deploy the accrue-oxygen edge function.
--   2. supabase secrets set ACCRUE_SECRET=<random value>
--   3. Store the SAME value in Vault under the name 'accrue_oxygen_secret'
--      (select vault.create_secret('<value>', 'accrue_oxygen_secret');) —
--      run that by hand; the secret is deliberately not in this file.
-- The 'project_url' Vault secret already exists from the analyze-photo trigger.

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

-- Re-running replaces the job of the same name.
select cron.schedule('accrue-oxygen-hourly', '0 * * * *', 'select public.request_accrue_oxygen();');
