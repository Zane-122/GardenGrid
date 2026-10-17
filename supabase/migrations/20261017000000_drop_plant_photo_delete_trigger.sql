-- Photo cleanup moved to the delete-plant edge function: Supabase blocks direct
-- DELETEs on storage.objects (storage.protect_delete), which made every plant
-- delete fail via this trigger.
drop trigger if exists plants_delete_photo on public.plants;
drop function if exists public.delete_plant_photo();
