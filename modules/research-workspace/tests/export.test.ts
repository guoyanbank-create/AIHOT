// 导出的纯函数：CSV 公式注入与转义、Markdown 分组。不碰数据库、不碰浏览器。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LedgerListEntry } from "../contracts.ts";
import { csvCell, ledgerCsv, ledgerMarkdown } from "../web/export.ts";

function entry(overrides: Partial<LedgerListEntry> = {}): LedgerListEntry {
  return {
    id: "e1",
    taskId: "t1",
    entryKey: "topic/a",
    version: 1,
    kind: "fact",
    status: "disclosed",
    title: "标题",
    body: "正文",
    author: null,
    model: null,
    modelVersion: null,
    runId: null,
    supersedesId: null,
    humanLocked: false,
    createdAt: "2026-11-14T05:30:00.000Z",
    evidence: [{ id: "v1", ledgerId: "e1", url: "https://example.com/a", publisher: "Example", channel: "rss:x", publishedAt: null, discoveredAt: null, fetchedAt: null, analyzedAt: null, bodyHash: null, quoteLocator: null, quote: "引文, 带逗号", license: null, createdAt: "2026-11-14T05:30:00.000Z" }],
    readState: null,
    ...overrides,
  };
}

test("CSV 单元格防公式注入并按 RFC 4180 转义", () => {
  assert.equal(csvCell("普通"), "普通");
  assert.equal(csvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(csvCell("+86 10"), "'+86 10");
  assert.equal(csvCell("@user"), "'@user");
  assert.equal(csvCell("-5"), "'-5");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
});

test("台账 CSV 一行一个版本，列固定", () => {
  const csv = ledgerCsv([entry(), entry({ id: "e2", version: 2, title: "=危险标题" })], new Map([["t1", "任务甲"]]));
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0]!.startsWith("任务,主题键,版本,种类,状态,标题"));
  assert.ok(lines[1]!.startsWith("任务甲,topic/a,1,事实,源披露"));
  assert.ok(lines[2]!.includes("'=危险标题"));
});

test("台账 Markdown 按任务分组，带状态、引用和备注", () => {
  const md = ledgerMarkdown([entry({ readState: { ledgerId: "e1", readAt: null, starred: false, needsCheck: true, note: "等官方 PDF", updatedAt: "2026-11-14T05:31:00.000Z" } })], new Map([["t1", "任务甲"]]));
  assert.ok(md.startsWith("# 调研台账"));
  assert.ok(md.includes("## 任务甲"));
  assert.ok(md.includes("### 标题"));
  assert.ok(md.includes("- 状态：源披露；种类：事实；版本：v1；时间：2026-11-14"));
  assert.ok(md.includes("- 人工备注：等官方 PDF"));
  assert.ok(md.includes("[https://example.com/a](https://example.com/a)"));
  assert.ok(md.includes("“引文, 带逗号”"));
});
