begin;

alter table rosie_runs
  add column provider text not null default 'api'
  check (provider in ('api', 'claude-agent', 'codex-agent'));

commit;
