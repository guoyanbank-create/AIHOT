CREATE INDEX CONCURRENTLY IF NOT EXISTS research_runs_task_started_idx ON research_runs (task_id, started_at DESC);
