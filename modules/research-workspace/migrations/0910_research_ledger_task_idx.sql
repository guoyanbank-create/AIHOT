CREATE INDEX CONCURRENTLY IF NOT EXISTS research_ledger_task_created_idx ON research_ledger_entries (task_id, created_at DESC);
