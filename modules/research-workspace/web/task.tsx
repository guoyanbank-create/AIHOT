// 任务详情：目标、节奏、信源、运行历史、报告和最近的台账。研究报告和待办都挂在任务上，不另做项目产品。
import { Form, Link, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import type { TaskDetail } from "../contracts.ts";
import { researchGet, researchSend } from "./api.server.ts";
import { Badge, BackLink, Card, Empty, LEDGER_STATUS, PageHead, RUN_STATUS, SectionTitle, TASK_STATUS, buttonClass, cadenceLabel, stamp } from "./ui.tsx";

export async function loader({ request, params }: LoaderFunctionArgs) {
  return researchGet<TaskDetail>(request, `/api/admin/research/tasks/${encodeURIComponent(params.id ?? "")}`);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const status = String(form.get("status") ?? "");
  await researchSend(request, "PATCH", `/api/admin/research/tasks/${encodeURIComponent(params.id ?? "")}`, { status });
  return { ok: true };
}

export const meta: MetaFunction = () => [{ title: `任务 · ${SITE.name}` }];
export const handle: Screen = { tab: "tasks", name: "任务" };

export default function Task() {
  const { task, runs, reports, ledger } = useLoaderData<typeof loader>();
  const [statusLabel, statusTone] = TASK_STATUS[task.status] ?? [task.status, "muted"];
  return (
    <>
      <div className="mb-2"><BackLink to="/tasks">任务</BackLink></div>
      <PageHead
        title={task.title}
        lead={cadenceLabel(task.cadence)}
        actions={
          <>
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {task.status === "active" ? (
              <Form method="post"><input type="hidden" name="status" value="paused" /><button type="submit" className={buttonClass("secondary")}>暂停</button></Form>
            ) : (
              <Form method="post"><input type="hidden" name="status" value="active" /><button type="submit" className={buttonClass("secondary")}>恢复</button></Form>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <SectionTitle title="研究目标" />
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{task.goal}</p>
            {task.outputTemplate && (
              <>
                <div className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-4">输出模板</div>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-3">{task.outputTemplate}</p>
              </>
            )}
          </Card>

          <section>
            <SectionTitle title="运行历史" />
            {runs.length ? (
              <Card className="divide-y divide-line p-0">
                {runs.map((run) => {
                  const [label, tone] = RUN_STATUS[run.status] ?? [run.status, "muted"];
                  return (
                    <div key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <Badge tone={tone}>{label}</Badge>
                      <span className="text-[12px] text-ink-4">{stamp(run.startedAt)}</span>
                      <span className="text-[12px] text-ink-4">搜索 {run.searchCalls} 次 · 模型 {run.modelCalls} 次</span>
                      {run.summary && <span className="w-full text-[12.5px] leading-relaxed text-ink-3">{run.summary}</span>}
                      {run.error && <span className="w-full text-[12.5px] leading-relaxed text-hot">{run.error}</span>}
                    </div>
                  );
                })}
              </Card>
            ) : (
              <Card><p className="text-[13px] text-ink-4">还没有运行记录。定时研究在后续阶段接上；研究流程会先读历史结论，再有界地搜索和抽取。</p></Card>
            )}
          </section>

          <section>
            <SectionTitle title="最近的台账" actions={<Link to={`/ledger?task=${task.id}`} className="text-[12.5px] text-ink-3 hover:text-accent">这个任务的台账 →</Link>} />
            {ledger.length ? (
              <Card className="divide-y divide-line p-0">
                {ledger.map((entry) => (
                  <Link key={entry.id} to={`/ledger?task=${task.id}&entry=${entry.id}`} className="block px-4 py-2.5 hover:bg-bg-sunk">
                    <div className="flex items-center gap-2">
                      <Badge tone={LEDGER_STATUS[entry.status]?.[1] ?? "muted"}>{LEDGER_STATUS[entry.status]?.[0] ?? entry.status}</Badge>
                      <span className="text-[11.5px] text-ink-4">v{entry.version}</span>
                      <span className="ml-auto text-[11.5px] text-ink-4">{stamp(entry.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 text-[13.5px] font-medium text-ink">{entry.title}</div>
                  </Link>
                ))}
              </Card>
            ) : (
              <Empty title="台账还是空的">研究跑出第一条正式事实或人工结论时，会出现在这里；每条事实都绑引用。</Empty>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <section>
            <SectionTitle title="信源" actions={<Link to="/sources" className="text-[12.5px] text-ink-3 hover:text-accent">管理 →</Link>} />
            <Card className="space-y-2">
              {task.sources.length ? task.sources.map((source) => (
                <div key={source.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-flex h-[20px] shrink-0 items-center rounded-full px-1.5 text-[11px] ${source.enabled ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-4"}`}>
                    {source.kind === "rss" ? "订阅" : source.kind === "web" ? "网页" : "搜索"}
                  </span>
                  <span className="mono min-w-0 break-all text-[12px] leading-relaxed text-ink-3">{source.locator}</span>
                </div>
              )) : <p className="text-[12.5px] text-ink-4">还没有信源，去信源页加。</p>}
            </Card>
          </section>

          <section>
            <SectionTitle title="报告" />
            {reports.length ? (
              <Card className="space-y-3">
                {reports.map((report) => (
                  <div key={report.id}>
                    <div className="text-[11.5px] text-ink-4">{stamp(report.createdAt)} · {report.kind === "summary" ? "研究摘要" : "提醒"}</div>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{report.body}</p>
                  </div>
                ))}
              </Card>
            ) : (
              <Card><p className="text-[12.5px] leading-relaxed text-ink-4">还没有报告。主动研究接上后，每次运行会在这里留一份摘要；待办也挂在任务上。</p></Card>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
