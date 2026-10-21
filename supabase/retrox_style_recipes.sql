-- Retrox's curated, versioned look recipes. User media is never stored here.
create table if not exists public.retrox_style_recipes (
  id text primary key check (id in ('none', 'cinema', 'mono', 'dream', 'neon', 'cultural-aura', 'lofi', 'vhs')),
  name text not null,
  description text not null default '',
  engine_version integer not null default 1 check (engine_version >= 1),
  recipe jsonb not null default '{}'::jsonb check (jsonb_typeof(recipe) = 'object'),
  is_published boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.retrox_style_recipes enable row level security;
revoke all on table public.retrox_style_recipes from anon, authenticated;
grant select on table public.retrox_style_recipes to anon, authenticated;
drop policy if exists "Published Retrox recipes are readable" on public.retrox_style_recipes;
create policy "Published Retrox recipes are readable"
on public.retrox_style_recipes
for select
to anon, authenticated
using (is_published = true);

insert into public.retrox_style_recipes (id, name, description, engine_version, recipe, is_published)
values
('none', 'Original', 'Keep the source colors clean.', 1, '{"brightness":0,"contrast":1,"saturation":1,"red":0,"green":0,"blue":0,"vignette":0,"grain":0,"monochrome":false}', true),
('cinema', 'Cinema', 'Deep film contrast with rich color.', 1, '{"brightness":-0.04,"contrast":1.12,"saturation":1.16,"red":0.015,"green":0,"blue":-0.015,"vignette":0.25,"grain":0,"monochrome":false}', true),
('mono', 'Mono', 'High-contrast black and white.', 1, '{"brightness":0,"contrast":1.12,"saturation":0,"red":0,"green":0,"blue":0,"vignette":0.15,"grain":0,"monochrome":true}', true),
('dream', 'Dream', 'Soft pastel brightness and gentle color.', 1, '{"brightness":0.045,"contrast":0.96,"saturation":1.2,"red":0.025,"green":0.005,"blue":-0.015,"vignette":0,"grain":0,"monochrome":false}', true),
('neon', 'Neon', 'Bold saturated color with punchy contrast.', 1, '{"brightness":0.005,"contrast":1.16,"saturation":1.55,"red":0.025,"green":-0.005,"blue":0.035,"vignette":0.15,"grain":0,"monochrome":false}', true),
('cultural-aura', 'Cultural Aura', 'Warm golden highlights, rich shadows and a subtle film finish.', 1, '{"brightness":0.01,"contrast":1.1,"saturation":1.24,"red":0.08,"green":0.02,"blue":-0.06,"vignette":0.3,"grain":3,"monochrome":false}', true),
('lofi', 'Lo-fi', 'Faded warm colors, soft contrast, gentle vignette and film grain.', 1, '{"brightness":0.035,"contrast":0.91,"saturation":0.76,"red":0.055,"green":0.01,"blue":-0.04,"vignette":0.4,"grain":8,"monochrome":false}', true),
('vhs', 'Retro VHS', 'Vintage color, visible grain and a nostalgic finish.', 1, '{"brightness":0.01,"contrast":1.07,"saturation":1.18,"red":-0.01,"green":0.01,"blue":0.035,"vignette":0.2,"grain":12,"monochrome":false}', true)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    engine_version = excluded.engine_version,
    recipe = excluded.recipe,
    is_published = excluded.is_published,
    updated_at = now();
