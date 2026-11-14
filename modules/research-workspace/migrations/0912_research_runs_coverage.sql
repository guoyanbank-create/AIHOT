-- 一次研究覆盖的时间段与实际做了多少（查询、结果、读到原文、读不到、被拒绝的抽取、是否 fixtures）。
-- 合并补跑时记下缺口，页面上如实显示，不承诺绝不漏数。
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS coverage jsonb;
