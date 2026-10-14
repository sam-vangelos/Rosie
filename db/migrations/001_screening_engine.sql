begin;

create table rosie_rubrics (
  id uuid primary key default gen_random_uuid(),
  rubric_version text not null,
  calibration_version text,
  rubric jsonb not null,
  ideal_patterns jsonb,
  job_id bigint,
  job_title text,
  created_by text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (rubric_version, calibration_version)
);

create table rosie_runs (
  id uuid primary key default gen_random_uuid(),
  job_id bigint not null,
  job_title text not null,
  mode text not null check (mode in ('new_or_changed', 'all', 'retry_failed_only', 'reopen_likely_no')),
  rubric_id uuid not null references rosie_rubrics(id),
  rubric_version text not null,
  calibration_version text,
  status text not null default 'queued' check (status in ('queued', 'fetching', 'processing', 'triaging', 'full_scoring', 'auditing', 'completed', 'canceled', 'failed')),
  stage text not null default 'fetch' check (stage in ('fetch', 'artifacts', 'triage', 'audit', 'score', 'finalize', 'done')),
  cancel_requested boolean not null default false,
  audit jsonb not null default '{"sampled":0,"disagreements":0,"strongSignalsFound":0,"escalatedLikelyNoBucket":false}',
  current_activity text,
  error text,
  eligible_total integer not null default 0,
  fetch_attempts integer not null default 0,
  owner_token uuid,
  leased_until timestamptz,
  claim_count integer not null default 0,
  created_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index rosie_runs_job_rubric_created_idx
  on rosie_runs (job_id, rubric_version, created_at desc);
create index rosie_runs_active_lease_idx
  on rosie_runs (leased_until)
  where status not in ('completed', 'canceled', 'failed');

create table rosie_run_candidates (
  run_id uuid not null references rosie_runs(id) on delete cascade,
  candidate_id text not null,
  candidate_name text not null,
  step text not null default 'pending_artifact' check (step in ('pending_artifact', 'pending_triage', 'awaiting_batch_triage', 'pending_score', 'pending_audit_score', 'awaiting_batch_score', 'triaged_only', 'fully_scored', 'audited', 'failed')),
  parse_quality text check (parse_quality in ('good', 'poor', 'missing')),
  audited boolean not null default false,
  escalated boolean not null default false,
  cache_hit boolean not null default false,
  attempt_count integer not null default 0,
  batch_id uuid,
  metadata jsonb not null default '{}',
  artifact_key text,
  resume_fingerprint text,
  triage_decision jsonb,
  full_score jsonb,
  failure text,
  updated_at timestamptz not null default now(),
  primary key (run_id, candidate_id)
);

create index rosie_run_candidates_run_step_idx
  on rosie_run_candidates (run_id, step);

create table rosie_resume_artifacts (
  artifact_key text primary key,
  resume_fingerprint text,
  resume_filename text,
  resume_mime_type text,
  resume_text text,
  parse_quality text not null check (parse_quality in ('good', 'poor', 'missing')),
  blob_path text,
  byte_size integer,
  created_at timestamptz not null default now()
);

create index rosie_resume_artifacts_fingerprint_idx
  on rosie_resume_artifacts (resume_fingerprint);

create table rosie_result_cache (
  namespace text not null check (namespace in ('triage-results', 'score-results')),
  cache_key text not null,
  payload jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (namespace, cache_key)
);

create table rosie_anthropic_batches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references rosie_runs(id) on delete cascade,
  stage text not null check (stage in ('triage', 'score', 'audit_score')),
  anthropic_batch_id text unique,
  status text not null default 'submitting' check (status in ('submitting', 'submitted', 'ended', 'ingested', 'expired', 'canceled', 'failed')),
  processing_status text,
  request_count integer not null default 0,
  request_counts jsonb,
  submitted_at timestamptz,
  ended_at timestamptz,
  ingested_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz not null default now()
);

create index rosie_anthropic_batches_active_run_idx
  on rosie_anthropic_batches (run_id)
  where status in ('submitting', 'submitted', 'ended');

commit;
