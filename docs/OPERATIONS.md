# 运维手册

## 启动 / 停止

```powershell
# 启动她（listener + wake），会写锁、记日志
powershell -ExecutionPolicy Bypass -File E:\DSH-herself\boot.ps1

# 强制重启（换代码之后必须做：她的进程是独立的）
powershell -ExecutionPolicy Bypass -File E:\DSH-herself\boot.ps1 -Force

# 停止
powershell -ExecutionPolicy Bypass -File E:\DSH-herself\stop-her.ps1
```

**两个进程**：`hands/qq.mjs listen`（收消息、回话）和 `wake.mjs`（定时唤醒、写摘要）。
各自有单实例锁（`logs/qq-listen.lock` / `logs/wake.lock`），第二个进程会安静退出并记录持有者 pid。

## 代码改了什么要重启谁

| 改动位置 | 生效方式 |
|---|---|
| `lib/*`、`hands/*` | **重启她**（`boot.ps1 -Force`），进程是独立的 |
| `plugin/lib/index.js`（服务端路由） | **重启 DSH**（插件在宿主进程里） |
| `plugin/lib/client.js`（面板） | 刷新页面（客户端） |
| `tools/ledger.json` 开关 | 即时（工具每次现读） |

## 体检与测试

```powershell
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

& $node tools/audit.mjs         # 35 项体检：链、BOM、槽位、预算、安全接线…
& $node test/replay.mjs         # 12 条契约回放
& $node test/derive.mjs         # 派生不变量（可重建/乱序）
& $node test/budget.mjs         # 事实预算
& $node test/recall.mjs         # 检索门控
& $node test/forget.mjs         # 遗忘三层
```

全部套件（25 个）一把梭：

```powershell
Get-ChildItem E:\DSH-herself\test\*.mjs | ForEach-Object { & $node $_.FullName 2>&1 | Select-Object -Last 1 }
```

## 观察她

```powershell
# 落盘日志（pid + 代码出厂时间）
Get-Content E:\DSH-herself\logs\dsh-herself.log -Tail 20

# 她被动起来听消息了吗
Get-Content E:\DSH-herself\logs\heartbeat-qq.txt

# 她怎么错的（每一轮的事实/检索/工具/推理）
Get-Content E:\DSH-herself\logs\trace.jsonl -Tail 1
```

面板：首页右下角悬浮球 → 会话列表 → 某条会话 → 点她那句话看整轮。

## 账本（试行）

```powershell
& $node tools/ledger.mjs            # 今天的候选
& $node tools/ledger.mjs status     # 三类开关
& $node tools/ledger.mjs off sleep  # 关掉"要睡"这一类
& $node tools/ledger.mjs on sleep
```

## 公共动作许可

她**在群里发表情**需要 24 小时许可（普通回话不需要）：

```powershell
& $node tools/approve.mjs           # 看现在有没有
& $node tools/approve.mjs allow     # 给 24 小时
& $node tools/approve.mjs deny      # 收回
```

## 漂移体检

```powershell
& $node tools/drift.mjs --save      # 存基线
& $node tools/drift.mjs             # 和基线比（三档；alert 时退出码 1）
& $node tools/drift.mjs --days 7    # 只看最近 7 天
```

## 常见故障

| 症状 | 先看什么 |
|---|---|
| 她不回话 | `heartbeat-qq.txt` 有没有更新；`qq.err.log` 大小；锁文件里的 pid 是不是活的 |
| 面板是空的 | DSH 是否重启过（客户端改动要刷新；服务端改动要重启 DSH） |
| 她说"没有钟" | `factsOf` 第一行有没有 `现在是…`；`think.mjs` 的 `clockText` |
| 她追同一件事 | `openCommitments` 的 TTL；有没有没关闭的 commitment |
| 她复述旧事很怪 | `logs/trace.jsonl` 的 `hits` 和 `facts`，看检索命中了什么 |
| 头像不显示 | `/dsh-herself/api/avatar?self=1` 是否 200；`logs/self.json` 有没有写 |

## 脱敏（准备公开仓库之前）

这个仓库默认不进版本库的部分已在 `.gitignore` 里。如果要把代码公开，还要过一遍：

1. **注释里的真实账号/群号**：`grep -rn "10001\|20002\|30003" lib hands tools plugin`
2. **她的原话**：注释里引用了不少她的原话（这是设计依据，但也是私人对话）
3. `HANDOFF.md`：开发日志，含大量真实场景，建议不放公开仓库（或另建 `docs/PROJECT-LOG.md` 摘要版）

## 环境

- Windows + PowerShell 5.1（插件调 `powershell.exe -File`，**脚本必须是 UTF-8 BOM**）
- Node 20+（本机用 DSH 内置的 node v24；`package.json` 无依赖）
- **OneBot 运行时：SnowLuma（默认）** + QQ NT；WebSocket `ws://127.0.0.1:3001`（HTTP 3000 / WebUI 5099），令牌在 `secrets/onebot.token`
  （NapCat 已放弃，只保留回滚：`$env:DSH_QQ_RUNTIME='napcat'` 再跑 `boot.ps1`）
- DSH（DeepSeek Harness）宿主 + 本插件