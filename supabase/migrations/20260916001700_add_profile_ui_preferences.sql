alter table public.profiles
    add column ui_preferences jsonb not null default '{}'::jsonb,
    add constraint profiles_ui_preferences_object
        check (jsonb_typeof(ui_preferences) = 'object');

grant update (ui_preferences) on table public.profiles to authenticated;
