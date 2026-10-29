# 数据模型

## 事件（唯一真相）

`life/events.jsonl`，一行一条 JSON。**只追加，永不修改**。

```jsonc
{
  "v": 1,                                   // 协议版本
  "id": "01M63VYNN80000000001XA2XQ2",       // ULID（时间有序、26 位）
  "ts": "2026-10-29T20:47:44.000+08:00",    // 发生时间（她的事件都带时区）
  "life": "life_t",                          // 哪一辈子（支持重建/迁移）
  "surface": "qq",                           // 从哪个界面来的：qq / dsh / system
  "type": "utterance",                       // 见下表
  "actor": "self",                           // self / other:<id> / system
  "acl": { "visibility": "private" },        // private / owner / public
  "prev": "sha256:…",                        // 上一条的哈希（链）
  "text": "行，那我挑着记…",                  // 内容
  "refs": ["01M63…"],                        // 可选：指向相关事件（她的话→触发它的那条）
  "evidence": ["01M63…"],                    // 可选：claim 的证据
  "meta": { "status": "open" }               // 可选：类型私有字段
}
```

`prev` 的算法：`sha256(stableStringify(event 去掉 prev 字段))`。
`tools/audit.mjs` 每次从头校验整条链，断一条就报。

## 事件类型

| type | 谁写的 | 用途 | 必填 |
|---|---|---|---|
| `seed` | system | 她的第一天 | text 可为空 |
| `encounter` | hands | 她撞见的事（别人说的话、看到的图） | text |
| `utterance` | think | 她自己说的话 | text |
| `refusal` | think | 她拒绝 | text |
| `revision` | system | 她自己改写过的立场 | text + refs |
| `reading` | system | 系统对她的解读（inferred） | text |
| `claim` | semantic | 蒸馏出的判断 | text + refs + evidence |
| `commitment` | think | 她许下的事（6h TTL） | text + meta.status |
| `preference` | think/system | 偏好（如思考档位 `reasoning`、作息 `routine`） | meta.key/value |
| `summary` | summary | 一段对话的摘要 | text + meta.thread |
| `tombstone` | system | 撤回（判错、误抽、过期） | text + refs |
| `action` | hands | 她做过的事（发消息、发表情） | text |
| `narration` | think | 她自己的叙事（当前 0 条——她没选择写） | text |
| `meta` | system | 记账（公共动作许可、档位） | meta.key/value |

## 派生状态（`derive(events, now)` 的返回）

```jsonc
{
  "day": 1,                         // 第几天（从 seed 算）
  "gates": ["trust"],               // 已通过的门（有序）
  "stage": 2,                       // 阶段（门的连续前缀长度）
  "beliefs": [                      // 判断（claims 优先；没有 claim 时退回 utterances）
    {
      "id": "01M63…",
      "text": "她拿到动图时通常只能看到定格的第一帧",
      "status": "active",           // active / superseded / refuted / refined
      "since": "2026-10-29T…",
      "until": "2026-10-29T…",      // 仅 superseded 有
      "supersededBy": "01M63…",     // 仅 superseded 有
      "via": "claim",
      "evidence": [{ "id": "01M63…", "at": "…", "text": "当时在回的那句" }]
    }
  ],
  "refusals": [{ "text": "…", "maintained": true }],
  "narrative": { "text": "我原来以为…" } | null,
  "counts": { "beliefs": 6, "active": 6, "superseded": 0, "refusals": 0, "claims": 6 }
}
```

## 判断的生命周期

```
utterance ──(semantic.distill)──→ claim（refs→那句，evidence→当时在回的事）
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
             superseded（被新判断顶掉）      refuted（被 revision 判错）
             until + supersededBy           status = refuted
```

- **supersede**：两条判断的二元组 Jaccard ≥ 0.5 就算"说的是同一件事"，后来的顶掉先前的；
- **tombstone**：判错了就撤回（事件流里还在，派生里看不见）；
- 三层不一样：**撤回**（这条错了）≠ **改口**（我改变主意了）≠ **遗忘**（太久了只说摘要）。

## ACL

- `private`：只有她自己和她所在的那个界面看得见；
- `owner`：主人可见；
- `public`：可以出门（当前没有公开出口）。

**ACL 在派生层切断，不在渲染层过滤**——这是最重要的一条：
即使某天渲染代码写错，私密事件也进不了她的提示词。

## 文件布局

```
life/
  events.jsonl       ★ 唯一真相
  state.json         派生缓存（可以删，删了会重算）
  people.json        跨平台认人（派生缓存）
  wake-state.json    唤醒状态
  diary/             留给"她自己的日记"（当前空）
  home/              她的"家"（留给未来的能力）
logs/
  dsh-herself.log    一行一条，落盘日志
  trace.jsonl        每轮思考过程（旁路，不进事件流）
  drift-baseline.json 漂移基线
  ledger.json        账本开关
  self.json          她自己的 QQ 号（悬浮球头像用）
secrets/
  deepseek.key       API key
  qq.json            主人 QQ 号
  onebot.token       OneBot 访问令牌
sandbox/             她唯一能写文件的目录
```