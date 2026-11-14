// 台账导出：CSV 和 Markdown。CSV 单元格防公式注入（以 = + - @ 制表符开头的先加单引号），
// 逗号、引号、换行按 RFC 4180 转义；两台机器上用同一份数据导出结果一致。
import type { LedgerListEntry } from "../contracts.ts";

const STATUS_LABEL: Record<string, string> = {
  disclosed: "源披露",
  cross_verified: "已交叉核验",
  conflict: "冲突",
  unverified: "未核实",
  withdrawn: "已撤回",
};

const KIND_LABEL: Record<string, string> = {
  fact: "事实",
  source_view: "来源观点",
  ai_assessment: "AI 研判",
  human_conclusion: "人工结论",
};

/** CSV 单元格：防公式注入，再按 RFC 4180 加引号。 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Excel / LibreOffice 会把 = + - @ 开头的单元格当公式；制表符和回车也能触发。加一个单引号让它当文本。
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const HEADER = ["任务", "主题键", "版本", "种类", "状态", "标题", "正文", "作者", "模型", "模型版本", "创建时间", "证据数", "已读", "收藏", "待核实", "备注"];

/** 台账的 CSV：一行一个台账版本。 */
export function ledgerCsv(entries: readonly LedgerListEntry[], taskTitles: ReadonlyMap<string, string>): string {
  const rows = entries.map((entry) => [
    taskTitles.get(entry.taskId) ?? entry.taskId,
    entry.entryKey,
    entry.version,
    KIND_LABEL[entry.kind] ?? entry.kind,
    STATUS_LABEL[entry.status] ?? entry.status,
    entry.title,
    entry.body,
    entry.author,
    entry.model,
    entry.modelVersion,
    entry.createdAt,
    entry.evidence.length,
    entry.readState?.readAt ? "是" : "否",
    entry.readState?.starred ? "是" : "否",
    entry.readState?.needsCheck ? "是" : "否",
    entry.readState?.note,
  ]);
  return [HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

const beijing = (iso: string) => `${new Date(iso).toISOString().slice(0, 10)}`;

/** 台账的 Markdown：按任务分组，每条带状态、引用和人工备注。 */
export function ledgerMarkdown(entries: readonly LedgerListEntry[], taskTitles: ReadonlyMap<string, string>, title = "调研台账"): string {
  const lines: string[] = [`# ${title}`, ""];
  const groups = new Map<string, LedgerListEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.taskId) ?? [];
    list.push(entry);
    groups.set(entry.taskId, list);
  }
  for (const [taskId, list] of groups) {
    lines.push(`## ${taskTitles.get(taskId) ?? taskId}`, "");
    for (const entry of list) {
      lines.push(`### ${entry.title}`, "");
      lines.push(`- 状态：${STATUS_LABEL[entry.status] ?? entry.status}；种类：${KIND_LABEL[entry.kind] ?? entry.kind}；版本：v${entry.version}；时间：${beijing(entry.createdAt)}`);
      if (entry.author) lines.push(`- 作者：${entry.author}`);
      if (entry.model) lines.push(`- AI 研判：${entry.model}${entry.modelVersion ? ` ${entry.modelVersion}` : ""}`);
      if (entry.readState?.note) lines.push(`- 人工备注：${entry.readState.note}`);
      lines.push("", entry.body || "（无正文）", "");
      if (entry.evidence.length) {
        lines.push("引用：");
        for (const item of entry.evidence) {
          lines.push(`- ${item.publisher ? `${item.publisher} · ` : ""}[${item.url}](${item.url})${item.publishedAt ? `（${beijing(item.publishedAt)}）` : ""}${item.quote ? `：“${item.quote}”` : ""}`);
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
