insert into public.shop_items (slug, name, description, oxygen_cost, image_path, footprint_cols, footprint_rows)
values (
  'light',
  'Light',
  'A garden lamp. It brightens the plots around it, and the glow reaches farther when the day is dim.',
  4000,
  'light.png',
  1,
  1
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    oxygen_cost = excluded.oxygen_cost,
    image_path = excluded.image_path,
    footprint_cols = excluded.footprint_cols,
    footprint_rows = excluded.footprint_rows;
