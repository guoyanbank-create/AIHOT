-- 长期研究任务：目标、节奏和输出模板。信源在 0901。
CREATE TABLE IF NOT EXISTS research_tasks (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  goal            text NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  cadence         jsonb NOT NULL,
  output_template text NOT NULL DEFAULT '',
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
