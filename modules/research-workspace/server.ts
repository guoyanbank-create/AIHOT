// 模块接进后端的插口（apps/api、apps/worker 启动时安装）：后台接口、研究运行队列、时间表和材料
// 版本提交事件。每个入库的材料版本在同一个事务里写进 research_outbox，任务支路不依赖 news 精选的结果。
import { defineServerModule } from "@aihot/backend/modules";
import { registerResearchApi } from "./api.ts";
import { RESEARCH_RUN_QUEUE, RESEARCH_SCHEDULES } from "./jobs.ts";
import { recordMaterialVersion } from "./material-events.ts";

export default defineServerModule({
  name: "research-workspace",
  http: registerResearchApi,
  queues: [RESEARCH_RUN_QUEUE],
  schedules: RESEARCH_SCHEDULES,
  on: {
    materialCommitted: recordMaterialVersion,
  },
});
