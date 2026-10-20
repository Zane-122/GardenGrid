-- More one-plot decorations, and the bench shrinks from 2 by 1 to a single plot.

insert into public.shop_items (slug, name, description, oxygen_cost, image_path, footprint_cols, footprint_rows)
values
  ('crate', 'Crate', 'A wooden crate for the corner of your garden.', 3000, 'crate.png', 1, 1),
  ('barrel', 'Barrel', 'An old barrel that has seen a few harvests.', 3000, 'barrel.png', 1, 1),
  ('sign', 'Sign', 'A signpost to point visitors the right way.', 3000, 'sign.png', 1, 1),
  ('redflower', 'Red flower', 'A bright red flower that needs no watering.', 2000, 'redflower.png', 1, 1),
  ('blueflower', 'Blue flower', 'A blue flower that needs no watering.', 2000, 'blueflower.png', 1, 1),
  ('fireplace', 'Fireplace', 'A stone fireplace for cool evenings.', 5000, 'fireplace.png', 1, 1),
  ('fountain', 'Fountain', 'A small stone fountain.', 8000, 'fountain.png', 1, 1)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    oxygen_cost = excluded.oxygen_cost,
    image_path = excluded.image_path,
    footprint_cols = excluded.footprint_cols,
    footprint_rows = excluded.footprint_rows;

update public.shop_items
set description = 'A wooden bench that sits on a single plot.',
    footprint_cols = 1,
    footprint_rows = 1
where slug = 'bench';

-- Benches that were already laid covered two plots. Keep only the anchor plot.
delete from public.user_shop_item_plots plots
using public.user_shop_items owned
join public.shop_items item on item.id = owned.shop_item_id
where plots.user_shop_item_id = owned.id
  and item.slug = 'bench'
  and plots.garden_tile_id is distinct from owned.garden_tile_id;

update public.user_shop_items owned
set rotation = 0
from public.shop_items item
where item.id = owned.shop_item_id
  and item.slug = 'bench';
