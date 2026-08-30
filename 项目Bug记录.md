# 项目 Bug 记录

> 这是项目的 bug 日志。遇到 bug 时:先开 git 分支(`git checkout -b fix/xxx`)再改,改完验证通过后合并,并把问题和解法记录到下表。
> 每行一条,只记真实发生过的 bug,不编造。

---

## 记录格式

| 日期 | 分支 | 问题描述 | 原因 | 解决方式 | 状态 |
|---|---|---|---|---|---|
| 2026-08-30 | `fix/home-bugs` | 首页 Hero「欢迎来到清吾的小屋」没有逐笔写出 | `hanzi-writer` 的 `create()` 只加载数据并静默挂载,不会自动播放笔画;需调用 `animateCharacter()`。且 `charDataLoader` 签名应为三参 `(char,onLoad,onError)` | `create()` 后调用 `animateCharacter({ onComplete })` 逐字链式播放;loader 改三参数;数据出错用 `.catch` 推进,不再卡住 | 已修 |
| 2026-08-30 | `fix/home-bugs` | 首页右栏「访客城市」同意定位后获取不到位置(可能卡在「定位中…」) | geolocation 可行,但 Nominatim 反向查询可能被网络阻断/限流而请求超时;原 `fetch` 无超时,导致一直卡住 | Nominatim 请求加 `AbortController` 9s 超时;geolocation 加 `timeout:12000` 选项;任何失败/超时兜底显示「🏠 未知」,不再卡住 | 已修 |

## 状态说明

- `待修` 已定位/已开分支,还没改完
- `已修` 已改完并验证通过
- `已关闭` 已合并、可复现问题解决

## 重要约定

- **遇到 bug 必须先开 git 分支再动手改**,不要直接在 main 上改。
- 分支命名:`fix/问题简述`,例如 `fix/hero-图片错位`。
- 改完写清楚:问题是什么、为什么会发生、怎么解决的、怎么验证通过。
- 如果一个 bug 反复出现,单独建一个 `fix/` 长期分支,并在备注里写明"反复出现"。

---

## Bug 列表

详见上方「记录格式」表:

1. `fix/home-bugs` Hero 笔顺问候未逐笔写出 → 已修
2. `fix/home-bugs` 访客城市定位获取不到 → 已修
