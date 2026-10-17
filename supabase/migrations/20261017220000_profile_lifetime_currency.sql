alter table public.profiles
  add column if not exists total_oxygen numeric not null default 0,
  add column if not exists total_pollen numeric not null default 0;

alter table public.profiles
  drop constraint if exists profiles_total_oxygen_check,
  drop constraint if exists profiles_total_pollen_check;

alter table public.profiles
  add constraint profiles_total_oxygen_check check (total_oxygen >= 0),
  add constraint profiles_total_pollen_check check (total_pollen >= 0);

comment on column public.profiles.total_oxygen is
  'Milliliters of oxygen ever earned. Increases when oxygen is credited and never goes down when currency is spent.';
comment on column public.profiles.total_pollen is
  'Cubic centimeters of pollen ever earned. Increases when pollen is credited and never goes down when currency is spent.';

-- Starting totals match whatever is already in the spendable balance.
update public.profiles as profile
set
  total_oxygen = greatest(profile.total_oxygen, currency.oxygen),
  total_pollen = greatest(profile.total_pollen, currency.pollen)
from public.user_currency as currency
where currency.user_id = profile.id;

create or replace function public.prevent_profile_lifetime_decrease()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.total_oxygen < old.total_oxygen or new.total_pollen < old.total_pollen then
    raise exception 'lifetime oxygen and pollen cannot decrease';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lifetime_currency_no_decrease on public.profiles;
create trigger profiles_lifetime_currency_no_decrease
  before update of total_oxygen, total_pollen on public.profiles
  for each row
  execute function public.prevent_profile_lifetime_decrease();

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

  update public.profiles
  set total_pollen = total_pollen + amount
  where id = target_user_id;

  return new_balance;
end;
$$;

create or replace function public.credit_oxygen(
  p_user_id uuid,
  p_amount numeric,
  p_expected_last timestamptz,
  p_new_last timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  applied integer;
begin
  if p_user_id is null or p_amount is null or p_amount < 0 or p_new_last is null then
    return false;
  end if;

  update public.user_currency
  set oxygen = oxygen + p_amount,
      oxygen_accrued_at = p_new_last,
      updated_at = now()
  where user_id = p_user_id
    and oxygen_accrued_at is not distinct from p_expected_last;

  get diagnostics applied = row_count;
  if applied > 0 then
    if p_amount > 0 then
      update public.profiles
      set total_oxygen = total_oxygen + p_amount
      where id = p_user_id;
    end if;
    return true;
  end if;

  -- No row was updated. Only a first accrual (no token yet) may create the
  -- row; a stale non-null token must never credit.
  if p_expected_last is null then
    insert into public.user_currency (user_id, oxygen, oxygen_accrued_at)
    values (p_user_id, p_amount, p_new_last)
    on conflict (user_id) do nothing;

    get diagnostics applied = row_count;
    if applied > 0 and p_amount > 0 then
      update public.profiles
      set total_oxygen = total_oxygen + p_amount
      where id = p_user_id;
    end if;
    return applied > 0;
  end if;

  return false;
end;
$$;

revoke all on function public.credit_user_pollen(uuid, numeric) from public;
revoke all on function public.credit_user_pollen(uuid, numeric) from anon, authenticated;
grant execute on function public.credit_user_pollen(uuid, numeric) to service_role;

revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) from public;
revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) to service_role;
