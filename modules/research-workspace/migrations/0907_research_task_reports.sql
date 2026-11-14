-- 任务详情里的研究报告与提醒；报告和待办都挂在任务上，不另做项目管理产品。
CREATE TABLE IF NOT EXISTS research_task_reports (
  id         text PRIMARY KEY,
  task_id    text NOT NULL REFERENCES research_tasks (id) ON DELETE CASCADE,
  run_id     text REFERENCES research_runs (id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('summary', 'alert')),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
