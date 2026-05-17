-- Run this in the Supabase SQL Editor once.
-- It creates one table to hold the shared "casa" state for the domino app.

create table if not exists domino_state (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Auto-bump updated_at on every update
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_domino_state_updated_at on domino_state;
create trigger trg_domino_state_updated_at
  before update on domino_state
  for each row execute function set_updated_at();

-- Seed the single shared row
insert into domino_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

-- Optional: lock down direct access from the client.
-- Our API uses the SERVICE_ROLE_KEY which bypasses RLS, so enabling RLS without
-- policies is the safest choice — no one with the anon key can read or write.
alter table domino_state enable row level security;
