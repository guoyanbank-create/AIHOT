-- 引用：原文地址、发布方、渠道和各阶段时间、正文 hash、引用定位与许可，报告和台账都能回到它。
CREATE TABLE IF NOT EXISTS research_evidence (
  id            text PRIMARY KEY,
  ledger_id     text NOT NULL REFERENCES research_ledger_entries (id) ON DELETE CASCADE,
  url           text NOT NULL,
  publisher     text,
  channel       text NOT NULL,
  published_at  timestamptz,
  discovered_at timestamptz,
  fetched_at    timestamptz,
  analyzed_at   timestamptz,
  body_hash     text,
  quote_locator text,
  quote         text,
  license       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
