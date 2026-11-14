CREATE INDEX CONCURRENTLY IF NOT EXISTS research_outbox_pending_idx ON research_outbox (id) WHERE dispatched_at IS NULL;
