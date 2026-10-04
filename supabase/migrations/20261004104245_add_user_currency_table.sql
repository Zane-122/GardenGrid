create table if not exists public.user_currency (
  user_id uuid primary key references auth.users(id) on delete cascade,
  oxygen numeric not null default 0 check (oxygen >= 0),
  pollen numeric not null default 0 check (pollen >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.user_currency is 'Each user''s spendable currencies. Read-only for users; only server code (service role) can change it.';
comment on column public.user_currency.oxygen is 'Oxygen earned from plants and not yet spent.';
comment on column public.user_currency.pollen is 'Pollen balance, not yet spent.';

alter table public.user_currency enable row level security;

create policy "Users can read their own currency"
  on public.user_currency
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.user_currency from anon, authenticated;
grant select on table public.user_currency to authenticated;
grant select, insert, update, delete on table public.user_currency to service_role;

insert into public.user_currency (user_id)
select id from auth.users
on conflict (user_id) do nothing;