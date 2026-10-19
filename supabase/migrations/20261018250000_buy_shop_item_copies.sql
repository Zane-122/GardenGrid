-- Buy several copies of one shop item. Each copy costs the catalog price.

create or replace function public.buy_shop_item(target_item uuid, copies integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cost numeric;
  balance numeric;
  total numeric;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if copies is null or copies < 1 or copies > 36 then
    raise exception 'Choose how many to buy';
  end if;

  select oxygen_cost into cost
  from public.shop_items
  where id = target_item;

  if cost is null then
    raise exception 'That item is not in the shop';
  end if;

  total := cost * copies;

  select oxygen into balance
  from public.user_currency
  where user_id = uid
  for update;

  if balance is null or balance < total then
    raise exception 'Not enough oxygen';
  end if;

  update public.user_currency
  set oxygen = oxygen - total,
      updated_at = now()
  where user_id = uid;

  insert into public.user_shop_items (user_id, shop_item_id)
  select uid, target_item
  from generate_series(1, copies);
end;
$$;

revoke all on function public.buy_shop_item(uuid, integer) from public, anon;
grant execute on function public.buy_shop_item(uuid, integer) to authenticated, service_role;

comment on function public.buy_shop_item(uuid, integer) is
  'Spends the item''s oxygen cost once per copy and gives the user that many copies.';
