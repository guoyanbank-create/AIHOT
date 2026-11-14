// 任务：长期研究任务列表，和四步创建（目标 → 信源 → 节奏 → 输出）。创建好在任务详情里看运行、报告和台账。
import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import type { TaskCadence, TaskOverview } from "../contracts.ts";
import { researchGet, researchSend } from "./api.server.ts";
import { Badge, Card, Empty, Field, PageHead, RUN_STATUS, TASK_STATUS, areaClass, buttonClass, cadenceLabel, inputClass, stamp } from "./ui.tsx";

export async function loader({ request }: LoaderFunctionArgs) {
  return researchGet<TaskOverview[]>(request, "/api/admin/research/tasks");
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  let draft: { title?: string; goal?: string; cadence?: TaskCadence; sources?: Array<{ kind?: string; locator?: string }>; outputTemplate?: string };
  try {
    draft = JSON.parse(String(form.get("payload") ?? "{}")) as typeof draft;
  } catch {
    return { error: "提交的数据不完整" };
  }
  try {
    const task = await researchSend<{ id: string }>(request, "POST", "/api/admin/research/tasks", {
      title: draft.title,
      goal: draft.goal,
      cadence: draft.cadence,
      outputTemplate: draft.outputTemplate ?? "",
      sources: draft.sources ?? [],
    });
    return { created: task.id };
  } catch (error) {
    return { error: error instanceof Response ? await error.text() : "创建失败" };
  }
}

export const meta: MetaFunction = () => [{ title: `任务 · ${SITE.name}` }];
export const handle: Screen = { tab: "tasks", name: "任务" };

const KINDS = [
  { value: "rss", label: "RSS / 订阅" },
  { value: "web", label: "网页" },
  { value: "search", label: "搜索查询" },
] as const;

const STEPS = ["目标", "信源", "节奏", "输出"];

export default function Tasks() {
  const tasks = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHead
        title="任务"
        lead="一个长期研究任务：研究目标、盯哪些信源、多久跑一次、输出成什么样。"
        actions={open ? null : <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>新建任务</button>}
      />
      {open && <Wizard onClose={() => setOpen(false)} />}
      <div className="mt-6 space-y-3">
        {tasks.length === 0 && !open && (
          <Empty title="还没有长期任务" action={<button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>按四步建一个</button>}>
            比如“盯住几家公司的官方公告里与模型发布、定价和合规有关的变化”。研究任务会在设定的时间主动找新线索，并把变化写进台账。
          </Empty>
        )}
        {tasks.map(({ task, latestRun, unreadCount, reportCount, nextRunAt }) => (
          <Card key={task.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link to={`/tasks/${task.id}`} className="text-[16px] font-semibold text-ink hover:text-accent">{task.title}</Link>
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{task.goal}</p>
              </div>
              <Badge tone={TASK_STATUS[task.status]?.[1] ?? "muted"}>{TASK_STATUS[task.status]?.[0] ?? task.status}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-4">
              <span>{cadenceLabel(task.cadence)}</span>
              <span>·</span>
              <span>{task.sources.length} 个信源</span>
              <span>·</span>
              <span>{reportCount} 份报告</span>
              {unreadCount > 0 && <><span>·</span><span className="text-accent">{unreadCount} 条未读变化</span></>}
              {latestRun ? (
                <><span>·</span><Badge tone={RUN_STATUS[latestRun.status]?.[1] ?? "muted"}>上次 {RUN_STATUS[latestRun.status]?.[0] ?? latestRun.status}</Badge><span>{stamp(latestRun.finishedAt ?? latestRun.startedAt)}</span></>
              ) : (
                <><span>·</span><span>还没有运行</span></>
              )}
              {nextRunAt && <><span>·</span><span>下次 {stamp(nextRunAt)}</span></>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/** 四步创建：草稿只在浏览器里；最后一步提交一次，任务和信源一起落库。 */
function Wizard({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [sources, setSources] = useState<Array<{ kind: "rss" | "web" | "search"; locator: string }>>([{ kind: "rss", locator: "" }]);
  const [cadenceKind, setCadenceKind] = useState<"daily" | "weekly" | "manual">("daily");
  const [at, setAt] = useState("05:30");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [outputTemplate, setOutputTemplate] = useState("先给结论，再列证据和变化；与上一版不同的地方单独标出来。");

  const created = fetcher.data && "created" in fetcher.data ? fetcher.data.created : undefined;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined;
  useEffect(() => {
    if (created) navigate(`/tasks/${created}`);
  }, [created, navigate]);

  const cadence: TaskCadence =
    cadenceKind === "manual" ? { kind: "manual" } : cadenceKind === "daily" ? { kind: "daily", at } : { kind: "weekly", at, weekdays: weekdays.length ? weekdays : [1] };
  const payload = JSON.stringify({ title, goal, cadence, outputTemplate, sources: sources.filter((source) => source.locator.trim()) });
  const canNext = step === 0 ? title.trim().length > 0 && goal.trim().length > 0 : step === 1 ? sources.some((source) => source.locator.trim()) : true;

  return (
    <Card className="mt-4">
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              className={`flex size-7 items-center justify-center rounded-full text-[12px] font-semibold ${index === step ? "bg-accent text-accent-contrast" : index < step ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-4"}`}
            >
              {index + 1}
            </button>
            <span className={`text-[12.5px] ${index === step ? "font-semibold text-ink" : "text-ink-4"}`}>{label}</span>
            {index < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
          </div>
        ))}
        <button type="button" onClick={onClose} className="ml-auto text-[12.5px] text-ink-4 hover:text-ink">取消</button>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <Field label="任务标题">
            <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 官方公告与定价变化" autoFocus />
          </Field>
          <Field label="研究目标" hint="要盯住什么、关心哪些变化。写给未来的自己看，也决定研究计划怎么问。">
            <textarea className={areaClass} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：盯住 OpenAI、Anthropic、Google DeepMind 的官方公告里与模型发布、定价、合规有关的变化；低热度的公告也要进任务。" />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-ink-4">信源可以是 RSS/订阅、要抓的网页，或一条搜索查询。同一个任务里的信源按添加顺序保存；相同信源只留一条。</p>
          {sources.map((source, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row">
              <select
                className={`${inputClass} sm:w-40`}
                value={source.kind}
                onChange={(event) => setSources(sources.map((item, at2) => (at2 === index ? { ...item, kind: event.target.value as typeof item.kind } : item)))}
                aria-label="信源类型"
              >
                {KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
              <input
                className={inputClass}
                value={source.locator}
                onChange={(event) => setSources(sources.map((item, at2) => (at2 === index ? { ...item, locator: event.target.value } : item)))}
                placeholder={source.kind === "search" ? "例如：OpenAI 官方 发布 定价 公告" : "https://…"}
                aria-label="信源地址或搜索查询"
              />
              {sources.length > 1 && (
                <button type="button" className="h-10 shrink-0 px-2 text-[12.5px] text-ink-4 hover:text-hot" onClick={() => setSources(sources.filter((_, at2) => at2 !== index))}>删除</button>
              )}
            </div>
          ))}
          <button type="button" className={buttonClass("secondary")} onClick={() => setSources([...sources, { kind: "search", locator: "" }])}>再加一条</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="研究节奏" hint="北京时间；定时研究在后续阶段接上（现在可以先手动跑，节奏先存下来）。">
            <select className={inputClass} value={cadenceKind} onChange={(event) => setCadenceKind(event.target.value as typeof cadenceKind)}>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="manual">手动</option>
            </select>
          </Field>
          {cadenceKind !== "manual" && (
            <Field label="时间（HH:mm）">
              <input className={`${inputClass} max-w-[140px]`} value={at} onChange={(event) => setAt(event.target.value)} placeholder="05:30" />
            </Field>
          )}
          {cadenceKind === "weekly" && (
            <Field label="哪几天">
              <div className="flex flex-wrap gap-1.5">
                {["日", "一", "二", "三", "四", "五", "六"].map((day, index) => {
                  const on = weekdays.includes(index);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setWeekdays(on ? weekdays.filter((item) => item !== index) : [...weekdays, index])}
                      className={`size-9 rounded-full border text-[12.5px] ${on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line-strong text-ink-3"}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Field label="输出模板" hint="研究摘要和报告按它写。">
            <textarea className={areaClass} value={outputTemplate} onChange={(event) => setOutputTemplate(event.target.value)} />
          </Field>
          <div className="well rounded-control p-3 text-[12.5px] leading-relaxed text-ink-3">
            <div className="font-medium text-ink-2">{title || "（未填标题）"}</div>
            <div className="mt-1">{cadenceLabel(cadence)} · {sources.filter((source) => source.locator.trim()).length} 个信源</div>
            <p className="mt-1 line-clamp-2">{goal}</p>
          </div>
          {error && <p role="alert" className="text-[12.5px] text-hot">{error}</p>}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between">
        <button type="button" className={buttonClass("secondary")} onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>{step === 0 ? "取消" : "上一步"}</button>
        {step < 3 ? (
          <button type="button" className={buttonClass("primary")} disabled={!canNext} onClick={() => setStep(step + 1)}>下一步</button>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="payload" value={payload} />
            <button type="submit" className={buttonClass("primary")} disabled={fetcher.state !== "idle" || !canNext}>{fetcher.state === "idle" ? "创建任务" : "创建中…"}</button>
          </fetcher.Form>
        )}
      </div>
    </Card>
  );
}
