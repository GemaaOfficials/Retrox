-- ReEditX Supabase backend: private media storage + durable FFmpeg job queue.
-- Apply this script once to the intended Supabase project using the SQL Editor or Supabase migration tooling.

create extension if not exists pgcrypto;

create table if not exists public.reeditx_render_jobs (
  id uuid primary key,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  message text not null default '',
  source_video_path text not null,
  source_audio_path text,
  output_object_path text not null,
  settings jsonb not null default '{}'::jsonb,
  duration_seconds double precision,
  output_duration_seconds double precision,
  source_has_audio boolean not null default false,
  output_name text not null default 'ReEditX-remix.mp4',
  output_bytes bigint,
  error_message text,
  client_token_hash text,
  worker_id text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 hours')
);

create index if not exists reeditx_render_jobs_queue_idx
  on public.reeditx_render_jobs (created_at)
  where status = 'queued';

create index if not exists reeditx_render_jobs_expiry_idx
  on public.reeditx_render_jobs (expires_at)
  where status in ('complete', 'failed');

alter table public.reeditx_render_jobs enable row level security;
revoke all on table public.reeditx_render_jobs from anon, authenticated;
grant all on table public.reeditx_render_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reeditx-media',
  'reeditx-media',
  false,
  52428800,
  array[
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    'video/x-m4v', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/flac', 'audio/webm',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.reeditx_worker_heartbeats (
 id text primary key, last_seen_at timestamptz not null default now(),
 active_jobs integer not null default 0 check (active_jobs >= 0), queued_jobs integer not null default 0 check (queued_jobs >= 0),
 updated_at timestamptz not null default now()
);
create index if not exists reeditx_worker_heartbeats_last_seen_idx on public.reeditx_worker_heartbeats(last_seen_at desc);
alter table public.reeditx_worker_heartbeats enable row level security;
revoke all on table public.reeditx_worker_heartbeats from anon, authenticated;
grant all on table public.reeditx_worker_heartbeats to service_role;

-- Claim one queue item atomically, allowing multiple worker instances to share the queue.
-- A processing job is eligible for retry if its worker stopped refreshing its heartbeat.
create or replace function public.claim_reeditx_render_job(p_worker_id text)
returns setof public.reeditx_render_jobs
language sql
security invoker
set search_path = ''
as $function$
  with candidate as (
    select id
    from public.reeditx_render_jobs
    where expires_at > now()
      and (
        status = 'queued'
        or (status = 'processing' and updated_at < now() - interval '2 minutes')
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update public.reeditx_render_jobs as jobs
  set
    status = 'processing',
    progress = greatest(jobs.progress, 1),
    message = 'Claimed by a ReEditX render worker.',
    worker_id = p_worker_id,
    attempts = jobs.attempts + 1,
    claimed_at = now(),
    updated_at = now()
  from candidate
  where jobs.id = candidate.id
  returning jobs.*;
$function$;

revoke all on function public.claim_reeditx_render_job(text) from public, anon, authenticated;
grant execute on function public.claim_reeditx_render_job(text) to service_role;
