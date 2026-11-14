// 模块网页读写的 HTTP 助手：网页进程只通过 HTTP 读 api（见 docs/architecture.md）；写操作带后台会话的
// CSRF，和 /api/admin/* 一样。这里跑在服务端，浏览器拿不到 cookie 和 token。
import type { AdminMe } from "@aihot/contracts/admin";
import { adminGet } from "@aihot/web/lib/admin.server";
import { API_BASE_URL } from "@aihot/web/lib/api.server";

export type { TaskDetail, TaskOverview, TodayOverview, LedgerView, LedgerEntryDetail, SourcesView, SettingsView } from "../contracts.ts";

export function researchGet<T>(request: Request, path: string): Promise<T> {
  return adminGet<T>(request, path);
}

/** 写操作：先拿到当前会话的 CSRF，再带着 cookie 调 api；失败把 api 的说明原样抛给页面。 */
export async function researchSend<T>(request: Request, method: "POST" | "PATCH" | "DELETE", path: string, payload?: unknown): Promise<T> {
  const me = await adminGet<AdminMe>(request, "/api/admin/me");
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: "application/json",
      cookie: request.headers.get("cookie") ?? "",
      "x-csrf-token": me.csrf,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
  });
  if (!res.ok) {
    let detail = `api ${res.status}`;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // 不是 JSON 的错误页
    }
    throw new Response(detail, { status: res.status });
  }
  return (await res.json()) as T;
}
