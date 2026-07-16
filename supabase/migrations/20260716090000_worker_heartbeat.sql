alter table public.auto_post_settings
  add column if not exists last_worker_tick_at timestamptz;
