// 设置：研究时区和硬上限、搜索提供商状态、数据量，以及后台（模型、付费请求上限、信源）的入口。
import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";
import { researchGet } from "./api.server.ts";
import { Badge, Card, PageHead, SectionTitle, Stat, buttonClass } from "./ui.tsx";
import type { SettingsView } from "../contracts.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  return researchGet<SettingsView>(request, "/api/admin/research/settings");
}

export const meta: MetaFunction = () => [{ title: `设置 · ${SITE.name}` }];
export const handle: Screen = { tab: "settings", name: "设置" };

export default function Settings() {
  const { timezone, limits, search, counts, engine } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHead title="设置" lead="研究怎么跑、能花多少；模型和付费请求上限仍然在原来的后台里。" />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle title="研究节奏与上限" />
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink-3">时区</span>
              <span className="text-ink-2">{timezone === "Asia/Shanghai" ? "Asia/Shanghai（北京时间）" : timezone}</span>
            </div>
            {[
              ["每次最多搜索", `${limits.queriesPerRun} 次`],
              ["每次最多读正文", `${limits.pagesPerRun} 页`],
              ["最多研究轮次", `${limits.roundsPerRun} 轮`],
              ["每次最多模型调用", `${limits.modelCallsPerRun} 次`],
              ["单次最长运行", `${limits.minutesPerRun} 分钟`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-ink-3">{label}</span>
                <span className="num text-ink-2">{value}</span>
              </div>
            ))}
            <p className="text-[11.5px] leading-relaxed text-ink-4">这些是硬上限的默认值，后续阶段做成可配置项时也只能往下调；搜索和模型调用都会经过回执和预算。</p>
          </Card>
        </section>

        <section>
          <SectionTitle title="搜索提供商" />
          <Card className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink-3">提供商</span>
              <span className="text-ink-2">{search.provider === "tavily" ? "Tavily" : search.provider}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink-3">凭证</span>
              {search.configured ? <Badge tone="ok">已配置</Badge> : <Badge tone="warn">未配置</Badge>}
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-4">
              主动研究阶段接上 SearchProvider（默认 Tavily）。没有凭证时会用清楚标识的本地 fixtures 演示流程，不会假装已经联网；搜索费用也接进回执和预算。
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle title="数据" />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="任务" value={counts.tasks} />
            <Stat label="信源" value={counts.sources} />
            <Stat label="台账版本" value={counts.entries} />
            <Stat label="运行记录" value={counts.runs} />
          </div>
        </section>

        <section>
          <SectionTitle title="原来的后台" />
          <Card className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-ink-3">模型和每一步的选型、付费请求上限、信源健康度、运行记录都在原来的后台里；这里不重复做一套。</p>
            <Link to={engine.adminUrl} className={buttonClass("secondary")}>打开后台设置</Link>
          </Card>
        </section>
      </div>
    </>
  );
}
