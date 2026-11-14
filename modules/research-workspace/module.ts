// 长期调研工作台（modules/research-workspace/）：它的地址。页面、跳转和交给 api 处理的路径在后续
// 阶段（任务、台账、信源、设置的主界面）里登记；现在先只有模块身份，见 docs/research-workspace/baseline.md。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "research-workspace",
  pages: [
    { path: "today", file: "web/today.tsx", id: "research-today" },
    { path: "tasks", file: "web/tasks.tsx", id: "research-tasks" },
    { path: "tasks/:id", file: "web/task.tsx", id: "research-task" },
    { path: "ledger", file: "web/ledger.tsx", id: "research-ledger" },
    { path: "sources", file: "web/sources.tsx", id: "research-sources" },
    { path: "settings", file: "web/settings.tsx", id: "research-settings" },
  ],
  apiPaths: [/^\/api\/admin\/research\//],
});
