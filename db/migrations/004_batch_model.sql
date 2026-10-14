-- Record the model each batch was submitted with. Ingestion may run in a
-- later process than submission (polling survives deploys), so cache keys
-- must come from the submission-time model, not the currently configured one
-- — otherwise a config change mid-flight files results under a model that
-- never produced them.
alter table rosie_anthropic_batches
  add column model text;
