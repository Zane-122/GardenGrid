alter table public.user_currency
  add column if not exists oxygen_accrued_at timestamptz;

comment on column public.user_currency.oxygen_accrued_at is
  'Timestamp up to which oxygen has been credited. Null until the first accrual run; used as the optimistic-lock token by credit_oxygen.';
comment on column public.user_currency.oxygen is
  'Milliliters (mL) of oxygen earned from plants and not yet spent. Never rounded.';

-- Credits oxygen (mL) exactly once per accrual window. The row is only
-- touched when its current oxygen_accrued_at still equals p_expected_last, so
-- two overlapping runs that read the same value cannot both credit: the second
-- one matches no row and gets false back.
create or replace function public.credit_oxygen(
  p_user_id uuid,
  p_amount numeric,
  p_expected_last timestamptz,
  p_new_last timestamptz
)
returns boolean
language plpgsql
security invoker
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
    return true;
  end if;

  -- No row was updated. Only a first accrual (no token yet) may create the
  -- row; a stale non-null token must never credit.
  if p_expected_last is null then
    insert into public.user_currency (user_id, oxygen, oxygen_accrued_at)
    values (p_user_id, p_amount, p_new_last)
    on conflict (user_id) do nothing;

    get diagnostics applied = row_count;
    return applied > 0;
  end if;

  return false;
end;
$$;

revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) from public;
revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) to service_role;

comment on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz) is
  'Atomically adds p_amount mL of oxygen and moves oxygen_accrued_at to p_new_last, only if oxygen_accrued_at is still p_expected_last. Returns whether the credit was applied.';
