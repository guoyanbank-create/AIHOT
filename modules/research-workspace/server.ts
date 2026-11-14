// 模块接进后端的插口（apps/api、apps/worker 启动时安装）。现在只挂材料版本提交事件：
// 每个入库的材料版本在同一个事务里写进 research_outbox，任务支路不再依赖 news 精选的结果。
import { defineServerModule } from "@aihot/backend/modules";
import { registerResearchApi } from "./api.ts";
import { recordMaterialVersion } from "./material-events.ts";

export default defineServerModule({
  name: "research-workspace",
  http: registerResearchApi,
  on: {
    materialCommitted: recordMaterialVersion,
  },
});
