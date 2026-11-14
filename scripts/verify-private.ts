// 私有站点的部署检查：先确认没有会话的人拿不到任何页面和公开出口，再用管理员密码登录，确认登录后页面、
// RSS、llms、站点地图、分享图、公开 API 与 MCP 都能用。api 和 web 要先跑起来（见 docs/deploy.md 的“全站私有”）。
//   node scripts/verify-private.ts --base http://127.0.0.1:3000 --password <ADMIN_PASSWORD>
//   node scripts/verify-private.ts --base http://web:3000 --password <ADMIN_PASSWORD>   # 在 compose 容器里跑
// 密码也可以放在环境变量 ADMIN_PASSWORD 里。退出码非 0 表示有检查没通过。
import { anonymousChecks, authenticatedChecks, check, probePrivate, signIn } from "./site-check.ts";

const value = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const base = (value("--base") ?? process.env.SITE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const password = value("--password") ?? process.env.ADMIN_PASSWORD ?? "";

let failed = 0;
failed += check(await probePrivate(base), "站点是全站私有的（匿名打开首页会去登录）");
failed += await anonymousChecks(base);
failed += check(password.length >= 12, "提供了 ADMIN_PASSWORD（至少 12 位）", password ? "" : "用 --password 或环境变量传入");
const cookie = password ? await signIn(base, password) : null;
failed += check(Boolean(cookie), "登录", cookie ? "" : "用管理员密码登录失败");
if (cookie) failed += await authenticatedChecks(base, cookie);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
