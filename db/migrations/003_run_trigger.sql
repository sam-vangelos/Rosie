begin;

alter table rosie_runs
  add column trigger text not null default 'manual'
  check (trigger in ('manual', 'scheduled'));

commit;
