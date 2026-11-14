// 信源：长期任务盯的订阅、网页和搜索查询。按任务分组；同一任务里相同信源只留一条。
import { Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import { researchGet, researchSend } from "./api.server.ts";
import { Badge, Card, Empty, Field, PageHead, SectionTitle, TASK_STATUS, buttonClass, inputClass } from "./ui.tsx";
import type { SourcesView } from "../contracts.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  return researchGet<SourcesView>(request, "/api/admin/research/sources");
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "add") {
    try {
      await researchSend(request, "POST", "/api/admin/research/sources", {
        taskId: String(form.get("taskId") ?? ""),
        kind: String(form.get("kind") ?? "rss"),
        locator: String(form.get("locator") ?? ""),
      });
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Response ? await error.text() : "添加失败" };
    }
  }
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "缺少信源 id" };
  if (intent === "toggle") await researchSend(request, "PATCH", `/api/admin/research/sources/${id}`, { enabled: form.get("value") === "true" });
  else if (intent === "remove") await researchSend(request, "DELETE", `/api/admin/research/sources/${id}`);
  else return { error: "未知操作" };
  return { ok: true };
}

export const meta: MetaFunction = () => [{ title: `信源 · ${SITE.name}` }];
export const handle: Screen = { tab: "sources", name: "信源" };

const KIND_LABEL: Record<string, string> = { rss: "订阅", web: "网页", search: "搜索" };

export default function Sources() {
  const { tasks } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined;
  const total = tasks.reduce((sum, task) => sum + task.sources.length, 0);

  return (
    <>
      <PageHead title="信源" lead={`${tasks.length} 个任务、${total} 条信源。订阅和网页由采集器抓，搜索查询交给 SearchProvider（后续阶段接上）。`} />

      <Card className="mb-6">
        <SectionTitle title="加一条信源" />
        <fetcher.Form method="post" className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,150px)_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="intent" value="add" />
          <Field label="任务">
            <select name="taskId" className={inputClass} required>
              <option value="">选择任务…</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </Field>
          <Field label="类型">
            <select name="kind" className={inputClass} defaultValue="rss">
              <option value="rss">订阅</option>
              <option value="web">网页</option>
              <option value="search">搜索查询</option>
            </select>
          </Field>
          <Field label="地址或查询">
            <input name="locator" className={inputClass} placeholder="https://… 或一条搜索查询" required />
          </Field>
          <button type="submit" className={buttonClass("primary")} disabled={fetcher.state !== "idle"}>添加</button>
        </fetcher.Form>
        {error && <p role="alert" className="mt-2 text-[12.5px] text-hot">{error}</p>}
      </Card>

      {tasks.length === 0 ? (
        <Empty title="还没有任务" action={<Link to="/tasks" className={buttonClass("primary")}>先建一个长期任务</Link>}>
          信源挂在任务上；建任务时也可以在第二步一起加。
        </Empty>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <section key={task.id}>
              <SectionTitle
                title={<span className="flex items-center gap-2 normal-case text-ink-2">{task.title}<Badge tone={TASK_STATUS[task.status]?.[1] ?? "muted"}>{TASK_STATUS[task.status]?.[0] ?? task.status}</Badge></span>}
                actions={<Link to={`/tasks/${task.id}`} className="text-[12.5px] text-ink-3 hover:text-accent">任务详情 →</Link>}
              />
              <Card className="divide-y divide-line p-0">
                {task.sources.length ? task.sources.map((source) => (
                  <div key={source.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <span className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-medium ${source.enabled ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-4"}`}>{KIND_LABEL[source.kind] ?? source.kind}</span>
                    <span className="mono min-w-0 flex-1 break-all text-[12px] text-ink-3">{source.locator}</span>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={source.id} />
                      <input type="hidden" name="value" value={String(!source.enabled)} />
                      <button type="submit" className="text-[12px] text-ink-3 hover:text-accent">{source.enabled ? "停用" : "启用"}</button>
                    </fetcher.Form>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="id" value={source.id} />
                      <button type="submit" className="text-[12px] text-ink-4 hover:text-hot">删除</button>
                    </fetcher.Form>
                  </div>
                )) : <p className="px-4 py-3 text-[12.5px] text-ink-4">这个任务还没有信源。</p>}
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
