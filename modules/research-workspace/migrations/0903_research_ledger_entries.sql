-- 台账：按主题键留版本历史，撤回也留版本，不删除。人工锁定的条目 AI 不覆盖。
CREATE TABLE IF NOT EXISTS research_ledger_entries (
  id            text PRIMARY KEY,
  task_id       text NOT NULL REFERENCES research_tasks (id) ON DELETE CASCADE,
  entry_key     text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  kind          text NOT NULL CHECK (kind IN ('fact', 'source_view', 'ai_assessment', 'human_conclusion')),
  status        text NOT NULL DEFAULT 'unverified'
                CHECK (status IN ('disclosed', 'cross_verified', 'conflict', 'unverified', 'withdrawn')),
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  author        text,
  model         text,
  model_version text,
  run_id        text REFERENCES research_runs (id) ON DELETE SET NULL,
  supersedes_id text REFERENCES research_ledger_entries (id) ON DELETE SET NULL,
  human_locked  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, entry_key, version)
);
