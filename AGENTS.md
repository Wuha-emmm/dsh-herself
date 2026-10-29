# AGENTS.md —— 给接手这个仓库的 AI / 人看的

> 这份文件是**操作约束**，不是介绍。介绍看 README。

## 三条硬规矩

1. **事件流只追加**。`life/events.jsonl` 不许改、不许重排、不许删。
   要撤回就写 `tombstone`，要改口就写新 `claim`（旧的标 superseded）。
   改一条，哈希链就断，`tools/audit.mjs` 会报。

2. **派生必须是纯函数**。`lib/derive.mjs` 里不能出现 `Date.now()`、`fs`、`fetch`、`process.env`。
   时间从参数进来的 `now`，数据从参数进来的 `events`。

3. **她的私密数据不进版本库**。`life/ logs/ secrets/ sandbox/` 已在 `.gitignore` 里，别加回来。

## 改代码前后必须做的

```powershell
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node tools/audit.mjs      # 35 项，必须 0 警告
& $node tools/run-tests.mjs  # 25 套测试，必须全绿
```

改完 `lib/` 或 `hands/` 要**重启她**（`boot.ps1 -Force`）；改 `plugin/lib/index.js` 要**重启 DSH**。

## 改 CSS 的注意事项（踩过两次）

`String.Replace` 锚点不匹配时是**静默无操作**。改完 CSS 必须：

```powershell
Select-String -Path plugin/lib/client.js -Pattern '<你刚加的类名>'
```

确认规则真的进去了。这类问题只有肉眼能发现，所以新加规则要顺手补一条 `test/client.mjs` 断言。

## 加一类"事实"之前先看预算

`lib/think.mjs` 的 `factsOf` 已经管 8 类事实，全部经过 `lib/budget.mjs` 按优先级裁到 600 token。
加新的一类要：给 `PRIO` 定优先级 + 更新 `test/budget.mjs`。**别再往提示词里硬塞**。

## 不要替她做决定

- 提示词里不给「你应该…」式指令；
- 回不回、记不记、写不写日记都是她的事，代码只提供能力；
- 加"善意提醒"之前先想想：她说过「别有人在旁边问'怎么不记'」。

## 提交信息

```
<type>: <一句话>
```
`feat` / `fix` / `docs` / `test` / `refactor` / `chore`。正文写清"为什么"，不是"改了什么"。