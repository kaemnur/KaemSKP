create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  local_profile_id text,
  nama_pegawai text,
  nip_username text,
  jabatan text,
  unit_kerja text,
  tahun_skp_aktif integer,
  periode_skp text,
  base_url_skp text not null default 'https://skp.sdm.kemendikdasmen.go.id',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skp_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_username text,
  encrypted_password text,
  encryption_version text not null default 'v1',
  last_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.skp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'not_logged_in',
  encrypted_storage_state text,
  encrypted_cookies text,
  display_name text,
  last_checked_at timestamptz,
  expires_at timestamptz,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.skp_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text,
  local_period_id text,
  year integer not null,
  start_date date not null,
  end_date date not null,
  label text not null,
  source_file text,
  profile_json jsonb,
  raw_text_hash text,
  imported_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_period_id),
  unique (user_id, year, start_date, end_date)
);

create table if not exists public.skp_plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.skp_plans(id) on delete cascade,
  local_id text,
  local_period_id text,
  kode_skp text not null,
  nama_skp text not null,
  penugasan_dari text,
  indikator_json jsonb,
  is_active boolean not null default true,
  site_option_text text,
  site_option_value text,
  match_status text not null default 'needs_review',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_id, kode_skp)
);

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text,
  local_period_id text,
  plan_id uuid references public.skp_plans(id) on delete set null,
  kode_log text not null,
  tanggal date not null,
  kode_skp text,
  nama_skp text,
  nama_aktivitas text,
  deskripsi text,
  indikator_kinerja_individu text,
  kuantitas_output text,
  satuan text,
  link_tautan text,
  status_local text not null,
  status_skp text not null,
  reason_type text,
  reason_note text,
  source_file text,
  source_hash text,
  last_sync_at timestamptz,
  last_error text,
  last_error_code text,
  current_url text,
  automation_step text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_period_id, kode_log)
);

create table if not exists public.daily_log_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_log_id uuid references public.daily_logs(id) on delete cascade,
  scheduler_job_id uuid,
  local_job_id text,
  local_item_id text,
  tanggal date not null,
  status text not null,
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  screenshot_path text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_item_id)
);

create table if not exists public.periodic_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text,
  plan_id uuid references public.skp_plans(id) on delete set null,
  local_period_id text,
  year integer not null,
  quarter integer not null check (quarter between 1 and 4),
  total_skp integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  submit_status text,
  status text not null,
  mode text not null,
  error_last text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

create table if not exists public.periodic_job_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  periodic_job_id uuid not null references public.periodic_jobs(id) on delete cascade,
  kode_skp text not null,
  nama_skp text not null,
  realization text,
  feedback_link text,
  status text not null,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auto_post_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  post_time time not null default '08:00',
  timezone text not null default 'Asia/Jakarta',
  active_weekdays integer[] not null default array[1,2,3,4,5],
  skip_holidays boolean not null default true,
  only_if_not_submitted boolean not null default true,
  retry_until_time time not null default '16:00',
  retry_interval_minutes integer not null default 10,
  next_auto_post_at timestamptz,
  worker_status text not null default 'waiting_for_worker',
  last_job_status text,
  last_job_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  is_joint_leave boolean not null default false,
  source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, holiday_date, name)
);

create table if not exists public.scheduler_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null,
  scheduled_date date not null,
  scheduled_at timestamptz not null,
  status text not null check (
    status in (
      'pending',
      'running',
      'success',
      'already_submitted',
      'skipped_weekend',
      'skipped_holiday',
      'no_log',
      'login_failed',
      'verification_failed',
      'failed'
    )
  ),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer not null default 0,
  daily_log_id uuid references public.daily_logs(id) on delete set null,
  result_message text,
  error_code text,
  error_message text,
  next_auto_post_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_type, scheduled_date)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_log_submissions_scheduler_job_fk'
  ) then
    alter table public.daily_log_submissions
      add constraint daily_log_submissions_scheduler_job_fk
      foreign key (scheduler_job_id) references public.scheduler_jobs(id) on delete set null;
  end if;
end;
$$;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text,
  event_type text not null,
  title text not null,
  message text,
  entity_type text,
  entity_id text,
  severity text,
  created_at timestamptz not null default now()
);

create index if not exists idx_skp_plan_items_user_plan on public.skp_plan_items(user_id, plan_id);
create index if not exists idx_daily_logs_user_tanggal on public.daily_logs(user_id, tanggal);
create index if not exists idx_daily_logs_user_status on public.daily_logs(user_id, status_skp, status_local);
create index if not exists idx_submissions_user_log on public.daily_log_submissions(user_id, daily_log_id);
create index if not exists idx_periodic_jobs_user_period on public.periodic_jobs(user_id, year, quarter);
create index if not exists idx_holidays_user_date on public.holidays(user_id, holiday_date) where is_active;
create index if not exists idx_scheduler_jobs_due on public.scheduler_jobs(status, scheduled_at);
create index if not exists idx_scheduler_jobs_user_status on public.scheduler_jobs(user_id, status, scheduled_date);
create index if not exists idx_audit_logs_user_created on public.audit_logs(user_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'skp_credentials',
    'skp_sessions',
    'skp_plans',
    'skp_plan_items',
    'daily_logs',
    'daily_log_submissions',
    'periodic_jobs',
    'periodic_job_items',
    'auto_post_settings',
    'holidays',
    'scheduler_jobs',
    'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'skp_credentials',
    'skp_sessions',
    'skp_plans',
    'skp_plan_items',
    'daily_logs',
    'daily_log_submissions',
    'periodic_jobs',
    'periodic_job_items',
    'auto_post_settings',
    'holidays',
    'scheduler_jobs',
    'audit_logs'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_own', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_own', table_name);

    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', table_name || '_delete_own', table_name);

    if table_name <> 'audit_logs' then
      execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
      execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    end if;
  end loop;
end;
$$;
