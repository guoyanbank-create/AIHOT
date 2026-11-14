-- 每次研究的运行记录：搜索失败、被预算拦下、被取消都不写成 no_change。
CREATE TABLE IF NOT EXISTS research_runs (
  id           text PRIMARY KEY,
  task_id      text NOT NULL REFERENCES research_tasks (id) ON DELETE CASCADE,
  scheduled_for timestamptz,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'succeeded', 'no_change', 'partial', 'failed', 'cancelled', 'budget_exceeded')),
  search_calls integer NOT NULL DEFAULT 0,
  model_calls  integer NOT NULL DEFAULT 0,
  summary      text,
  error        text
);
