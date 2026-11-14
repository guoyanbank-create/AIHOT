// 模块接进网页的插口（apps/web 的 site/modules/web.ts 读它）。五个主菜单：今日、任务、台账、信源、设置；
// 页面本身在 module.ts 里登记，文件在 web/ 下。
import type { WebModule } from "@aihot/web/modules";
import type { NavItem, Tab } from "@aihot/web/components/shell/nav";
import { IconBolt, IconDoc, IconList, IconMonitor, IconRss } from "@aihot/web/components/icons";

const items: NavItem[] = [
  { to: "/today", label: "今日", icon: IconBolt, end: true },
  { to: "/tasks", label: "任务", icon: IconList, covers: ["/tasks"] },
  { to: "/ledger", label: "台账", icon: IconDoc },
  { to: "/sources", label: "信源", icon: IconRss },
  { to: "/settings", label: "设置", icon: IconMonitor, end: true },
];

const tabs: Tab[] = [
  { key: "today", to: "/today", label: "今日", icon: IconBolt },
  { key: "tasks", to: "/tasks", label: "任务", icon: IconList },
  { key: "ledger", to: "/ledger", label: "台账", icon: IconDoc },
  { key: "sources", to: "/sources", label: "信源", icon: IconRss },
  { key: "settings", to: "/settings", label: "设置", icon: IconMonitor },
];

export default { name: "research-workspace", sidebar: { section: "工作台", items }, tabs } satisfies WebModule;
