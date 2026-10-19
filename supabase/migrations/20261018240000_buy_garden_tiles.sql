-- Buy several edge plots in one purchase. Each plot is priced from how many
-- plots are already owned, so the second costs more than the first.

create or replace function public.buy_garden_tiles(targets jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer;
  i integer;
  target jsonb;
  cell_col integer;
  cell_row integer;
  key text;
  seen text[] := array[]::text[];
  cols integer[] := array[]::integer[];
  cell_rows integer[] := array[]::integer[];
  owned_keys text[];
  pending text[];
  found text;
  candidate text;
  owned_count integer;
  purchased integer;
  oxygen_total numeric := 0;
  pollen_total numeric := 0;
  balance_oxygen numeric;
  balance_pollen numeric;
  neighbor_col integer;
  neighbor_row integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if targets is null or jsonb_typeof(targets) <> 'array' or jsonb_array_length(targets) = 0 then
    raise exception 'Choose at least one plot';
  end if;

  n := jsonb_array_length(targets);
  if n > 36 then
    raise exception 'Buy fewer plots at once';
  end if;

  for i in 0 .. n - 1 loop
    target := targets -> i;
    cell_col := (target ->> 'col')::integer;
    cell_row := (target ->> 'row')::integer;
    if cell_col is null or cell_row is null then
      raise exception 'Choose a plot';
    end if;
    key := cell_col::text || ':' || cell_row::text;
    if key = any (seen) then
      raise exception 'That plot is listed twice';
    end if;
    seen := array_append(seen, key);
    cols := array_append(cols, cell_col);
    cell_rows := array_append(cell_rows, cell_row);
  end loop;

  perform public.seed_starter_garden(uid);

  perform 1
  from public.garden_tiles
  where user_id = uid
  for update;

  if exists (
    select 1
    from public.garden_tiles as tile
    where tile.user_id = uid
      and (tile.col::text || ':' || tile.row::text) = any (seen)
  ) then
    raise exception 'You already own that plot';
  end if;

  select coalesce(array_agg(tile.col::text || ':' || tile.row::text), array[]::text[]), count(*)
  into owned_keys, owned_count
  from public.garden_tiles as tile
  where tile.user_id = uid;

  pending := seen;
  while cardinality(pending) > 0 loop
    found := null;
    foreach candidate in array pending loop
      neighbor_col := split_part(candidate, ':', 1)::integer;
      neighbor_row := split_part(candidate, ':', 2)::integer;
      if (neighbor_col::text || ':' || (neighbor_row - 1)::text) = any (owned_keys)
        or (neighbor_col::text || ':' || (neighbor_row + 1)::text) = any (owned_keys)
        or ((neighbor_col - 1)::text || ':' || neighbor_row::text) = any (owned_keys)
        or ((neighbor_col + 1)::text || ':' || neighbor_row::text) = any (owned_keys)
      then
        found := candidate;
        exit;
      end if;
    end loop;

    if found is null then
      raise exception 'You can only buy a plot on the edge of your garden';
    end if;

    purchased := greatest(owned_count - 12, 0);
    oxygen_total := oxygen_total + (1000 + 250 * purchased);
    pollen_total := pollen_total + (100 + 25 * purchased);
    owned_count := owned_count + 1;
    owned_keys := array_append(owned_keys, found);
    pending := array_remove(pending, found);
  end loop;

  select oxygen, pollen into balance_oxygen, balance_pollen
  from public.user_currency
  where user_id = uid
  for update;

  if balance_oxygen is null or balance_oxygen < oxygen_total or balance_pollen < pollen_total then
    raise exception 'Not enough oxygen or pollen';
  end if;

  update public.user_currency
  set oxygen = oxygen - oxygen_total,
      pollen = pollen - pollen_total,
      updated_at = now()
  where user_id = uid;

  insert into public.garden_tiles (user_id, col, row)
  select uid, cell.cell_col, cell.cell_row
  from unnest(cols, cell_rows) as cell(cell_col, cell_row);
end;
$$;

revoke all on function public.buy_garden_tiles(jsonb) from public, anon;
grant execute on function public.buy_garden_tiles(jsonb) to authenticated, service_role;

comment on function public.buy_garden_tiles(jsonb) is
  'Buys one or more plots that stay connected to the garden. Each plot costs 1000 + 250 oxygen and 100 + 25 pollen per plot already bought, including earlier plots in the same purchase.';
