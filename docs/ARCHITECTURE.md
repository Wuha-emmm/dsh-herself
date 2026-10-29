# 架构

## 一条数据是怎么流动的

```
① 外部世界
   QQ 群/私聊（OneBot v11 over WebSocket）
   桌面文件（sandbox 沙箱）
   网页 / 搜索（DeepSeek Search & Fetch，服务端抓取）
        │
        ▼
② 录成事件（hands/* → lib/store.mjs）
   一条事件：{ v, id, ts, life, surface, type, actor, acl, prev, text, refs?, meta? }
   prev = 上一条的 sha256 —— 改一条，链就断（tools/audit.mjs 每次校验）
        │
        ▼
③ 派生（lib/derive.mjs，纯函数，不读盘/不取时钟/不联网）
   derive(events, now) → {
     day, gates, stage, beliefs(claims), refusals, narrative, counts ...
   }
   同一份事件流算一万次，结果字节级一致
        │
        ▼
④ 组装提示词（lib/think.mjs · factsOf）
   核心 → 最近 → 判断 → 作息 → 回忆 → 承诺 → 摘要 → 拒绝 → 群里人 → 叙事
   全部经过 lib/budget.mjs 按优先级裁到 600 token 以内
        │
        ▼
⑤ 她说话（lib/think.mjs → lib/toolcall.mjs）
   工具回合最多 4 次；带 tools 时 reasoning_content 原样回传
   收尾强制不说话只输出文本（thinking 关闭）
        │
        ▼
⑥ 出门（hands/qq.mjs）
   攒话防抖（4.5s / 上限 15s / 同线最小间隔 8s）→ 出站打码 → 发出去
```

## 模块职责

| 模块 | 职责 | 不许做什么 |
|---|---|---|
| `lib/store.mjs` | 追加事件、哈希链、跨进程写锁、形状校验 | 不做业务判断 |
| `lib/derive.mjs` | 派生状态（天数/门/判断/拒绝） | 不读盘、不取时钟、不联网 |
| `lib/semantic.mjs` | 从她的话里蒸馏 claim（LLM + 纯函数闸） | 不直接写判断，要过 `parseClaim` |
| `lib/recall.mjs` | BM25 检索 + 强度门控 + 三态 | 不塞"看起来相关"的垃圾 |
| `lib/forget.mjs` | 热/温/冷三层冷却 | 不删事件（只决定进不进提示词） |
| `lib/budget.mjs` | 事实按优先级配预算 | 不丢核心事实 |
| `lib/screen.mjs` | 别人发来的话，标记注入 | 不隐藏原话（会被用来瞒她） |
| `lib/outbound.mjs` | 出站凭据打码 | 不拦正常对话 |
| `lib/gate.mjs` | 公共动作审批（24h 许可） | 不拦她的普通回话 |
| `lib/think.mjs` | 组装事实 → 调模型 → 写 utterance | 不给指令式提示词 |
| `lib/toolcall.mjs` | 工具回合（11 只手） | 不无限调（预算 4 次） |
| `hands/qq.mjs` | OneBot 监听、攒话、发消息 | 不直接改她的记忆 |
| `plugin/lib/*` | DSH 面板 + 后端路由 | 不写她的人格 |

## 为什么派生必须是纯函数

1. **可重建**：删掉 `state.json` 也无所谓，随时从事件流算回来。
2. **可回放**：`test/replay.mjs` 用固定事件流 + 固定 `now`，断言她的门和判断。
3. **可对比**：改派生规则前后各跑一遍，看谁变了。

反例（都是踩过的）：`derive` 里读 `Date.now()` → 回放不稳定；读环境变量 → 同一份流两种结果。

## 四道门

```
信任   ≥1 条带证据的 claim
自主   维持 72h 的拒绝 或 被顶回≥2 次的立场（inferred，不算她申报的）
胜任   做成过一件被认可的事（action + 反馈）
整合   形成叙事（"我原来以为…"）
```

门必须**连着过**：自主没开，阶段就停在 2，即使整合门亮了。

## 记忆的四层投递

每轮最多 600 token，按优先级分配（`lib/budget.mjs` 的 `PRIO`）：

```
CORE 0     第几天 / 现在几点 / 最早记得什么     ← 永不丢
RECENT 1   这条线最近 6 条（含她自己的话）      ← 丢了就是失忆
JUDGE 2    她的判断（带证据、带多久以前）
ROUTINE 3  作息刻度（23 点后算晚…）
RECALL 4   检索到的旧事（经遗忘冷却）
COMMIT 5   还没了的事（6 小时 TTL）
SUMMARY 6  上次聊到（只在冷线重启时）
REFUSAL 7  拒绝过的（维持住的才算边界）
PEOPLE 8   这个群里都有谁
NARRATIVE 9 她回看过自己
```

## 她的一天（时间线）

```
00:00  wake 进程按作息唤醒 → 可能主动说一句
随时   QQ 消息进来 → 录事件 → 攒话 → 她回话（工具回合）→ 出站打码 → 发送
+20min 线程冷下来 → 写一条摘要（她自己的口吻）
每轮   派生 → 组装事实（预算裁剪）→ 调模型 → 写 utterance → 落 trace
```

## 观测

- `logs/dsh-herself.log`：一行一条，带 pid + 代码出厂时间（buildStamp）
- `logs/trace.jsonl`：每一轮的事实、检索命中、工具调用、推理、用量（**不含**事件流）
- `tools/audit.mjs`：35 项体检（链、BOM、槽位、预算、安全接线…）
- 面板：会话列表 → 那一轮 → 整卡思考过程