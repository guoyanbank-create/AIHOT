// 台账：默认看“自上次阅读以来的变化”，可按任务和阅读状态筛选；每条事实/结论都能打开证据、版本差异和
// 人工备注，并导出 CSV / Markdown。打开一条就把它标成已读。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import type { LedgerEntryDetail, LedgerListEntry, LedgerView } from "../contracts.ts";
import { researchGet, researchSend } from "./api.server.ts";
import { ledgerCsv, ledgerMarkdown } from "./export.ts";
import { Badge, Card, Drawer, Empty, Field, LEDGER_KIND, LEDGER_STATUS, PageHead, areaClass, buttonClass, inputClass, stamp } from "./ui.tsx";

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未读" },
  { key: "starred", label: "收藏" },
  { key: "needsCheck", label: "待核实" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "all";
  const task = url.searchParams.get("task");
  const entry = url.searchParams.get("entry");
  const query = new URLSearchParams({ filter });
  if (task) query.set("task", task);
  const [view, detail] = await Promise.all([
    researchGet<LedgerView>(request, `/api/admin/research/ledger?${query}`),
    entry ? researchGet<LedgerEntryDetail>(request, `/api/admin/research/ledger/${encodeURIComponent(entry)}`) : Promise.resolve(null),
  ]);
  return { view, detail, filter, task };
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (intent === "read-all") {
    const taskId = String(form.get("taskId") ?? "");
    await researchSend(request, "POST", "/api/admin/research/ledger/read-all", taskId ? { taskId } : {});
    return { ok: true };
  }
  if (!id) return { error: "缺少台账 id" };
  if (intent === "read") await researchSend(request, "PATCH", `/api/admin/research/ledger/${id}/state`, { read: true });
  else if (intent === "starred") await researchSend(request, "PATCH", `/api/admin/research/ledger/${id}/state`, { starred: form.get("value") === "true" });
  else if (intent === "needsCheck") await researchSend(request, "PATCH", `/api/admin/research/ledger/${id}/state`, { needsCheck: form.get("value") === "true" });
  else if (intent === "note") await researchSend(request, "PATCH", `/api/admin/research/ledger/${id}/state`, { note: String(form.get("note") ?? "") });
  else return { error: "未知操作" };
  return { ok: true };
}

export const meta: MetaFunction = () => [{ title: `台账 · ${SITE.name}` }];
export const handle: Screen = { tab: "ledger", name: "台账" };

const download = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function Ledger() {
  const { view, detail, filter, task } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const titles = useMemo(() => new Map(view.tasks.map((item) => [item.id, item.title])), [view.tasks]);
  const href = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    return `?${query}`;
  };

  return (
    <>
      <PageHead
        title="台账"
        lead="按时间演进的正式事实、来源观点、AI 研判和人工结论；每条都能回到原文证据。"
        actions={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => download("ledger.csv", ledgerCsv(view.entries, titles), "text/csv;charset=utf-8")}>导出 CSV</button>
            <button type="button" className={buttonClass("secondary")} onClick={() => download("ledger.md", ledgerMarkdown(view.entries, titles), "text/markdown;charset=utf-8")}>导出 Markdown</button>
            <form method="post">
              <input type="hidden" name="intent" value="read-all" />
              <input type="hidden" name="taskId" value={task ?? ""} />
              <button type="submit" className={buttonClass("primary")}>全部标为已读</button>
            </form>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Link key={item.key} to={href({ filter: item.key === "all" ? null : item.key, entry: null })} className={`chip !h-8 ${filter === item.key ? "!border-accent/35 !bg-accent-soft !text-accent font-semibold" : ""}`}>
            {item.label}
            <span className="num text-[11px] opacity-70">
              {item.key === "all" ? view.counts.all : item.key === "unread" ? view.counts.unread : item.key === "starred" ? view.counts.starred : view.counts.needsCheck}
            </span>
          </Link>
        ))}
        <form method="get" className="ml-auto">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <select name="task" defaultValue={task ?? ""} className={`${inputClass} !h-8 max-w-[220px] !text-[12.5px]`} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
            <option value="">全部任务</option>
            {view.tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </form>
      </div>

      {view.entries.length ? (
        <Card className="divide-y divide-line p-0">
          {view.entries.map((entry) => (
            <Link key={entry.id} to={href({ entry: entry.id })} className={`block px-4 py-3 transition-colors hover:bg-bg-sunk ${entry.readState?.readAt ? "" : "bg-accent-softer/40"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={LEDGER_STATUS[entry.status]?.[1] ?? "muted"}>{LEDGER_STATUS[entry.status]?.[0] ?? entry.status}</Badge>
                <span className="text-[11.5px] text-ink-4">{LEDGER_KIND[entry.kind] ?? entry.kind} · v{entry.version} · {entry.evidence.length} 条引用</span>
                {entry.humanLocked && <Badge tone="accent">人工锁定</Badge>}
                {entry.readState?.needsCheck && <Badge tone="warn">待核实</Badge>}
                {entry.readState?.starred && <Badge tone="accent">收藏</Badge>}
                <span className="ml-auto text-[11.5px] text-ink-4">{stamp(entry.createdAt)}</span>
              </div>
              <div className="mt-1 text-[14px] font-medium leading-snug text-ink">{entry.title}</div>
              {entry.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-3">{entry.body}</p>}
              <div className="mt-1 text-[11.5px] text-ink-4">{view.tasks.find((item) => item.id === entry.taskId)?.title ?? entry.taskId}</div>
            </Link>
          ))}
        </Card>
      ) : (
        <Empty title={filter === "all" ? "台账还是空的" : "这个筛选下没有条目"} action={<Link to="/tasks" className={buttonClass("secondary")}>去任务里看看</Link>}>
          {filter === "all" ? "研究任务产出正式事实、来源观点、AI 研判或人工结论后会进台账；每条正式事实都绑引用。" : "换一个筛选，或先在研究任务里更新台账。"}
        </Empty>
      )}

      <Detail entry={detail ? detail : null} filter={filter} task={task} />
    </>
  );
}

/** 台账的详情抽屉：证据、版本差异和人工阅读状态。 */
function Detail({ entry, filter, task }: { entry: LedgerEntryDetail | null; filter: string; task: string | null }) {
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const marked = useRef<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!entry) return;
    setNote(entry.readState?.note ?? "");
    // 打开即已读：只提交一次，避免 action 重新验证后再次触发。
    if (readState?.readAt || marked.current === entry.entry.id) return;
    marked.current = entry.entry.id;
    const form = new FormData();
    form.set("intent", "read");
    form.set("id", entry.entry.id);
    fetcher.submit(form, { method: "post" });
  }, [entry, fetcher]);

  const closeHref = () => {
    const query = new URLSearchParams();
    if (filter !== "all") query.set("filter", filter);
    if (task) query.set("task", task);
    return `?${query}`;
  };

  if (!entry) return null;
  const { entry: item, versions, readState } = entry;
  const version = versions.find((candidate) => candidate.id === item.id) ?? item;
  const previous = versions[versions.indexOf(version) - 1] ?? null;
  const changes = previous
    ? [
        previous.title !== version.title ? ["标题", previous.title, version.title] : null,
        previous.status !== version.status ? ["状态", LEDGER_STATUS[previous.status]?.[0] ?? previous.status, LEDGER_STATUS[version.status]?.[0] ?? version.status] : null,
        previous.body !== version.body ? ["正文", previous.body, version.body] : null,
      ].filter(Boolean) as Array<[string, string, string]>
    : [];

  return (
    <Drawer open onClose={() => navigate(closeHref())} title={item.title}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={LEDGER_STATUS[item.status]?.[1] ?? "muted"}>{LEDGER_STATUS[item.status]?.[0] ?? item.status}</Badge>
        <span className="text-[12px] text-ink-4">{LEDGER_KIND[item.kind] ?? item.kind} · v{item.version} · {stamp(item.createdAt)}</span>
        {item.author && <span className="text-[12px] text-ink-4">作者：{item.author}</span>}
        {item.model && <span className="text-[12px] text-ink-4">AI 研判：{item.model}{item.modelVersion ? ` ${item.modelVersion}` : ""}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <FormButton entryId={item.id} intent="starred" value={!readState?.starred} on={Boolean(readState?.starred)}>收藏</FormButton>
        <FormButton entryId={item.id} intent="needsCheck" value={!readState?.needsCheck} on={Boolean(readState?.needsCheck)}>待核实</FormButton>
      </div>

      <div className="mt-4 whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-2">{item.body || "（无正文）"}</div>

      <section className="mt-6">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-4">引用与证据</h3>
        {item.evidence.length ? (
          <div className="space-y-2">
            {item.evidence.map((evidence) => (
              <div key={evidence.id} className="well rounded-control p-3">
                <a href={evidence.url} target="_blank" rel="noreferrer noopener" className="mono break-all text-[12px] text-accent hover:underline">{evidence.url}</a>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
                  {evidence.publisher && <span>{evidence.publisher}</span>}
                  <span>渠道：{evidence.channel}</span>
                  {evidence.publishedAt && <span>发布：{stamp(evidence.publishedAt)}</span>}
                  {evidence.fetchedAt && <span>抓取：{stamp(evidence.fetchedAt)}</span>}
                  {evidence.analyzedAt && <span>分析：{stamp(evidence.analyzedAt)}</span>}
                  {evidence.license && <span>许可：{evidence.license}</span>}
                </div>
                {evidence.quote && <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink-3">“{evidence.quote}”</blockquote>}
                {evidence.bodyHash && <div className="mono mt-1 truncate text-[10.5px] text-ink-4">sha256 {evidence.bodyHash}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-4">这条没有绑定引用。正式事实和人工结论必须有引用；来源观点和 AI 研判也应当能落到原文。</p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-4">版本差异</h3>
        {previous ? (
          changes.length ? (
            <div className="space-y-2">
              {changes.map(([field, before, after]) => (
                <div key={field} className="rounded-control border border-line p-3">
                  <div className="text-[11.5px] font-semibold text-ink-3">{field}（v{previous.version} → v{version.version}）</div>
                  <div className="mt-1 grid gap-2 text-[12px] leading-relaxed sm:grid-cols-2">
                    <div className="rounded-control bg-hot-soft/40 p-2 text-ink-2">− {before || "（空）"}</div>
                    <div className="rounded-control bg-ok-soft/50 p-2 text-ink-2">+ {after || "（空）"}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-4">这一版只改了元数据（例如证据或状态时间），标题、状态和正文与 v{previous.version} 相同。</p>
          )
        ) : (
          <p className="text-[12.5px] text-ink-4">这是第一版。修订和撤回都会新增版本，旧版本不删除。</p>
        )}
        {versions.length > 1 && (
          <div className="mt-2 text-[11.5px] text-ink-4">同一主题键共 {versions.length} 个版本：{versions.map((candidate) => `v${candidate.version}`).join(" → ")}</div>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-4">人工备注</h3>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="note" />
          <input type="hidden" name="id" value={item.id} />
          <Field label="只给本人看的判断、下一句要问什么">
            <textarea name="note" className={areaClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：等官方 PDF；这条与上周的公告冲突，先别写进报告。" />
          </Field>
          <button type="submit" className={`${buttonClass("secondary")} mt-2`} disabled={fetcher.state !== "idle"}>保存备注</button>
        </fetcher.Form>
      </section>
    </Drawer>
  );
}

function FormButton({ entryId, intent, value, on, children }: { entryId: string; intent: string; value: boolean; on: boolean; children: string }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={entryId} />
      <input type="hidden" name="value" value={String(value)} />
      <button type="submit" aria-pressed={on} className={`chip !h-8 ${on ? "!border-accent/35 !bg-accent-soft !text-accent font-semibold" : ""}`}>
        {children}{on ? " ✓" : ""}
      </button>
    </fetcher.Form>
  );
}
