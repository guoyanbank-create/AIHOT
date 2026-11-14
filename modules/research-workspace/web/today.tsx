// 今日：自上次阅读以来的变化、需要你决定的事（待核实/收藏）、任务运行和最近的研究运行。
import { Form, Link, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import { researchGet, researchSend, type TodayOverview } from "./api.server.ts";
import { Badge, Card, DotBadge, Empty, LEDGER_KIND, LEDGER_STATUS, PageHead, RUN_STATUS, SectionTitle, Stat, buttonClass, stamp } from "./ui.tsx";

export async function loader({ request }: LoaderFunctionArgs) {
  return researchGet<TodayOverview>(request, "/api/admin/research/today");
}

export async function action({ request }: ActionFunctionArgs) {
  await researchSend(request, "POST", "/api/admin/research/ledger/read-all", {});
  return { ok: true };
}

export const meta: MetaFunction = () => [{ title: `今日 · ${SITE.name}` }];
export const handle: Screen = { tab: "today", name: "今日" };

export default function Today() {
  const data = useLoaderData<typeof loader>();
  const tasks = data.tasks;
  const activeTasks = tasks.filter((item) => item.task.status === "active").length;
  const running = data.recentRuns.filter((run) => run.status === "running").length;

  return (
    <>
      <PageHead
        title="今日"
        lead={`自上次阅读以来的变化、需要你决定的事和任务的运行情况；时间按${data.timezone === "Asia/Shanghai" ? "北京时间" : data.timezone}。`}
        actions={
          <>
            <Form method="post">
              <button type="submit" className={buttonClass("secondary")}>全部标为已读</button>
            </Form>
            <Link to="/tasks" className={buttonClass("primary")}>新建任务</Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="未读变化" value={data.counts.unread} hint="自上次阅读以来的台账版本" />
        <Stat label="待核实" value={data.counts.needsCheck} hint="标了需要回原文核对" />
        <Stat label="收藏" value={data.counts.starred} />
        <Stat label="任务" value={`${activeTasks}/${tasks.length}`} hint={running ? `${running} 个运行中` : "进行中 / 全部"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section>
            <SectionTitle title="自上次阅读以来的变化" actions={<Link to="/ledger?filter=unread" className="text-[12.5px] text-ink-3 hover:text-accent">查看台账 →</Link>} />
            {data.unread.length ? (
              <Card className="divide-y divide-line p-0">
                {data.unread.map((entry) => (
                  <Link key={entry.id} to={`/ledger?entry=${entry.id}`} className="block px-4 py-3 transition-colors hover:bg-bg-sunk">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={LEDGER_STATUS[entry.status]?.[1] ?? "muted"}>{LEDGER_STATUS[entry.status]?.[0] ?? entry.status}</Badge>
                      <span className="text-[11.5px] text-ink-4">{LEDGER_KIND[entry.kind] ?? entry.kind} · v{entry.version}</span>
                      <span className="ml-auto text-[11.5px] text-ink-4">{stamp(entry.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-[14px] font-medium leading-snug text-ink">{entry.title}</div>
                    {entry.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-3">{entry.body}</p>}
                    <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-4">
                      <span>{tasks.find((item) => item.task.id === entry.taskId)?.task.title ?? "任务"}</span>
                      <span>·</span>
                      <span>{entry.evidence.length} 条引用</span>
                    </div>
                  </Link>
                ))}
              </Card>
            ) : (
              <Empty title="还没有未读变化" action={<Link to="/tasks" className={buttonClass("secondary")}>去任务里建第一个长期研究</Link>}>
                研究任务跑出新线索、修订或撤回时，新的台账版本会出现在这里。
              </Empty>
            )}
          </section>

          <section>
            <SectionTitle title="最近运行" actions={<Link to="/tasks" className="text-[12.5px] text-ink-3 hover:text-accent">全部任务 →</Link>} />
            {data.recentRuns.length ? (
              <Card className="divide-y divide-line p-0">
                {data.recentRuns.map((run) => {
                  const [label, tone] = RUN_STATUS[run.status] ?? [run.status, "muted"];
                  return (
                    <Link key={run.id} to={`/tasks/${run.taskId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-sunk">
                      <Badge tone={tone}>{label}</Badge>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{run.taskTitle}</span>
                      <span className="text-[11.5px] text-ink-4">{stamp(run.finishedAt ?? run.startedAt)}</span>
                    </Link>
                  );
                })}
              </Card>
            ) : (
              <Card><p className="text-[13px] text-ink-4">还没有运行记录。研究任务会在设定的时间自动跑（定时任务在后续阶段接上）。</p></Card>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section>
            <SectionTitle title="任务" actions={<Link to="/tasks" className="text-[12.5px] text-ink-3 hover:text-accent">管理 →</Link>} />
            {tasks.length ? (
              <Card className="divide-y divide-line p-0">
                {tasks.map(({ task, latestRun, unreadCount }) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="block px-4 py-3 hover:bg-bg-sunk">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{task.title}</span>
                      {unreadCount > 0 && <span className="num rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">{unreadCount}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-4">
                      {latestRun ? <DotBadge tone={RUN_STATUS[latestRun.status]?.[1] ?? "muted"}>{RUN_STATUS[latestRun.status]?.[0] ?? latestRun.status}</DotBadge> : <DotBadge>未运行</DotBadge>}
                      <span>{task.sources.length} 个信源</span>
                      {task.lastRunAt && <><span>·</span><span>{stamp(task.lastRunAt)}</span></>}
                    </div>
                  </Link>
                ))}
              </Card>
            ) : (
              <Empty title="还没有长期任务" action={<Link to="/tasks" className={buttonClass("primary")}>按四步建一个</Link>}>
                目标 → 信源 → 节奏 → 输出，建好后它会定期找线索、更新台账。
              </Empty>
            )}
          </section>

          <section>
            <SectionTitle title="要留意的" actions={<Link to="/ledger?filter=needsCheck" className="text-[12.5px] text-ink-3 hover:text-accent">全部 →</Link>} />
            <Card className="p-0">
              <div className="divide-y divide-line">
                {[...data.needsCheck.slice(0, 4), ...data.starred.slice(0, 3)].map((entry) => (
                  <Link key={entry.id} to={`/ledger?entry=${entry.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-bg-sunk">
                    {entry.readState?.needsCheck ? <Badge tone="warn">待核实</Badge> : <Badge tone="accent">收藏</Badge>}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{entry.title}</span>
                  </Link>
                ))}
                {!data.needsCheck.length && !data.starred.length && <p className="px-4 py-4 text-[13px] text-ink-4">没有标成待核实或收藏的台账。台账里可以给任意一条加这些标记。</p>}
              </div>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
