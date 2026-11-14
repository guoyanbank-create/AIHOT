// 模块接进网页的插口（apps/web 的 site/modules/web.ts 读它）。五个主菜单（今日、任务、台账、信源、
// 设置）的页面在后续阶段登记到这里，见 modules/research-workspace/module.ts。
import type { WebModule } from "@aihot/web/modules";

export default { name: "research-workspace" } satisfies WebModule;
