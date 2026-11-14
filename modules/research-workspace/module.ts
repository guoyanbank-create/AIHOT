// 长期调研工作台（modules/research-workspace/）：它的地址。页面、跳转和交给 api 处理的路径在后续
// 阶段（任务、台账、信源、设置的主界面）里登记；现在先只有模块身份，见 docs/research-workspace/baseline.md。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({ name: "research-workspace" });
