# tools/ —— 运维与诊断脚本

一次性脚本也在这里。判断标准很简单：**能回答一个具体问题的，留着**。

## 每次改代码都会用

| 脚本 | 干什么 |
|---|---|
| `audit.mjs` | 体检。0 警告才算过；另有「待看」清单，只报不拦 |
| `run-tests.mjs` | 全部测试（缺数据的套件会声明 NEEDS 并跳过） |
| `changelog.mjs` | 写改动单 **+** 同时投通知进她邮箱（`--backfill` 补漏） |
| `link-check.mjs` | 列七天内碰过代码、但挂不上改动单 hash 的提交（`--post` 投她邮箱） |

## 她自己的东西

| 脚本 | 干什么 |
|---|---|
| `inbox.mjs` | 她的邮箱：`list` / `next`（一次只领一条）/ `done <ref> <回复>` / `release` / `seen` |
| `budget-breakdown.mjs` | 905 花在哪：按段列出 token 构成，写 `sandbox/预算明细.md` |
| `backfill-facts.mjs` | 把被预算剪掉的「叙事」「群里的人」按天捞出来给她看 |
| `pick-review.mjs` | 挑判断的记录：`nomatch [n]` 抽查"模型说无关"的那几条（默认抽一半、最少 5 条） |
| `pick-replay.mjs` | 用真样本重放挑判断，换 prompt 看是长度问题还是描述问题 |
| `tool-usage.mjs` | 一周窗口（起点写死在 `logs/tool-usage-start.json`）内，三只手被用了几次、用在哪 |

## 运维

| 脚本 | 干什么 |
|---|---|
| `brain.mjs` | 脑子锁：`status` / `release` |
| `ledger.mjs` | 账本 |
| `drift.mjs` | 漂移检查 |
| `approve.mjs` | 群发表情的 24 小时审批 |
| `backfill-thread.mjs` | 老事件补线程号（`--dry` 先看） |
| `label-stickers.mjs` | 表情库打标 |
| `scrape-snowluma.mjs` | 扒 SnowLuma 的 API 目录，写进她沙盒（她可以自己翻） |
| `test-image.mjs` | 单张图跑一遍看图链路 |
| `push-github.ps1` | 推仓库（带重试，SSL 抖动时用） |