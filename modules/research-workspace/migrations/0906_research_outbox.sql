-- 事务 outbox：事件和产生它的写入同一个事务提交，派发成功后写 dispatched_at。
CREATE TABLE IF NOT EXISTS research_outbox (
  id            bigserial PRIMARY KEY,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text
);
