// 工作台页面共用的零件：页头、卡片、状态标签、表单控件、右侧抽屉和文案。颜色、圆角和间距都用站点
// 自己的 design token（app.css），不另起一套样式。
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { buttonClass } from "@aihot/web/components/ui/Controls";
import { IconClose } from "@aihot/web/components/icons";
import { beijingStamp } from "@aihot/contracts/time";
import type { TaskCadence } from "../contracts.ts";

export { buttonClass };

export function PageHead({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {lead && <p className="mt-1 text-[13px] leading-relaxed text-ink-4">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card p-4 lg:p-5 ${className}`}>{children}</section>;
}

export function SectionTitle({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-4">{title}</h2>
      {actions}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-3.5">
      <div className="text-[12px] text-ink-4">{label}</div>
      <div className="num mt-1 text-[22px] font-bold leading-none text-ink">{value}</div>
      {hint && <div className="mt-1 text-[11.5px] leading-snug text-ink-4">{hint}</div>}
    </div>
  );
}

type Tone = "ok" | "warn" | "bad" | "accent" | "muted";
const TONES: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-amber-soft text-amber-ink",
  bad: "bg-hot-soft text-hot",
  accent: "bg-accent-soft text-accent",
  muted: "bg-bg-sunk text-ink-3",
};

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export function DotBadge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
      <span className={`size-1.5 rounded-full ${tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-amber" : tone === "bad" ? "bg-hot" : tone === "accent" ? "bg-accent" : "bg-ink-4"}`} />
      {children}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card">
      <EmptyState title={title} action={action}>
        {children}
      </EmptyState>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-ink-2">{label}</span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-4">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export const inputClass = "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-accent";
export const areaClass = "min-h-[96px] w-full rounded-control border border-line-strong bg-surface p-3 text-[13.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-accent";

/** 右侧抽屉：台账的证据、备注和版本差异在它里面看。 */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "详情"}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto flex h-dvh w-full max-w-[600px] flex-col bg-bg shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 text-[15px] font-semibold text-ink">{title}</div>
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-ink-3 hover:bg-bg-sunk hover:text-ink" aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-[12.5px] text-ink-3 hover:text-accent">
      ← {children}
    </Link>
  );
}

export const RUN_STATUS: Record<string, [string, Tone]> = {
  running: ["运行中", "accent"],
  succeeded: ["成功", "ok"],
  no_change: ["没有变化", "muted"],
  partial: ["部分完成", "warn"],
  failed: ["失败", "bad"],
  cancelled: ["已取消", "muted"],
  budget_exceeded: ["超出预算", "bad"],
};

export const LEDGER_STATUS: Record<string, [string, Tone]> = {
  disclosed: ["源披露", "muted"],
  cross_verified: ["已交叉核验", "ok"],
  conflict: ["冲突", "bad"],
  unverified: ["未核实", "warn"],
  withdrawn: ["已撤回", "bad"],
};

export const LEDGER_KIND: Record<string, string> = {
  fact: "事实",
  source_view: "来源观点",
  ai_assessment: "AI 研判",
  human_conclusion: "人工结论",
};

export const TASK_STATUS: Record<string, [string, Tone]> = {
  active: ["进行中", "ok"],
  paused: ["已暂停", "warn"],
  archived: ["已归档", "muted"],
};

export function cadenceLabel(cadence: TaskCadence): string {
  if (cadence.kind === "manual") return "手动触发";
  if (cadence.kind === "daily") return `每天 ${cadence.at}`;
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `每${cadence.weekdays.map((day) => days[day]).join("、")} ${cadence.at}`;
}

export const stamp = (iso: string | null): string => (iso ? beijingStamp(iso) : "—");
