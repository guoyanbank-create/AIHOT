-- 单人阅读状态：已读、收藏、待核实和人工备注。台账条目被删时一起删。
CREATE TABLE IF NOT EXISTS research_read_state (
  ledger_id   text PRIMARY KEY REFERENCES research_ledger_entries (id) ON DELETE CASCADE,
  read_at     timestamptz,
  starred     boolean NOT NULL DEFAULT false,
  needs_check boolean NOT NULL DEFAULT false,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
