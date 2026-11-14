CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS research_runs_task_scheduled_uniq ON research_runs (task_id, scheduled_for) WHERE scheduled_for IS NOT NULL;
