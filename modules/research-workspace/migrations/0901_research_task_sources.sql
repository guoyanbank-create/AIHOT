-- 任务自己的信源：订阅地址、网页，或一条搜索查询。同一任务里同一信源只留一条。
CREATE TABLE IF NOT EXISTS research_task_sources (
  id         text PRIMARY KEY,
  task_id    text NOT NULL REFERENCES research_tasks (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('rss', 'web', 'search')),
  locator    text NOT NULL,
  -- 添加顺序：四步创建时用户排的顺序原样保留。
  position   integer NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, kind, locator)
);
