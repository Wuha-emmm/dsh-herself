const LIVE_CSS = `
      /* 别指望宿主的全局 reset：不写 border-box，feed 的 padding 会把宽度撑出去，气泡被裁 */
      .dlive,.dlive *{box-sizing:border-box}
      .dlive{display:flex;gap:14px;align-items:flex-start;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 2px}
      .dlive .feed{width:min(44%,400px);max-height:72vh;overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px}
      .dlive .detail{flex:1;min-width:0;max-height:72vh;overflow:auto}
      /* 窄的时候上下排，不然右栏被挤成一条缝 */
      @media (max-width:760px){
        .dlive{flex-direction:column}
        .dlive .feed{width:100%;max-height:42vh}
        .dlive .detail{max-height:none;width:100%}
      }
      .dlive .msgs{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px}
      .dlive .sep{text-align:center;font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin:10px 0 8px;letter-spacing:.03em}
      .dlive .msg{display:flex;margin-bottom:10px}
      .dlive .msg.left{justify-content:flex-start}
      .dlive .msg.right{justify-content:flex-end}
      /* 气泡底色写死，不用主题变量：--dsw-alias-brand-primary 在某些主题下是白色，
         结果就是白底白字（2026-10-29 截图里就是这么翻的）。 */
      /* 引用/转发/图/表情/语音：QQ 那边是块，这边先用小标签标出来（2026-10-30） */
      .dlive .segs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px}
      .dlive .segs .seg{font-size:10px;padding:0 5px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);opacity:.75}
      .dlive .bub{max-width:88%;border-radius:14px;padding:7px 11px 8px;line-height:19px;word-break:break-word}
      .dlive .bub.him{background:rgba(127,127,127,.18);color:inherit;border-bottom-left-radius:5px}
      .dlive .bub.her{background:#4d6bfe;color:#fff;border-bottom-right-radius:5px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.22)}
      .dlive .bub.her:hover{filter:brightness(1.08)}
      .dlive .bub.her.on{outline:2px dashed rgba(255,255,255,.9);outline-offset:2px}
      .dlive .bub .who{font-size:10.5px;opacity:.78;margin-bottom:3px;display:flex;gap:8px;justify-content:space-between;align-items:baseline}
      .dlive .bub .txt{white-space:pre-wrap;word-break:break-word}
      .dlive .bub .badge{font-size:10.5px;opacity:.86;margin-top:5px;border-top:.5px solid rgba(255,255,255,.32);padding-top:3px}
      .dlive .filters{display:flex;gap:8px;margin-bottom:10px;align-items:center}
      .dlive .f{padding:3px 11px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dlive .f.on{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-weight:600}
      .dlive .k{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
      .dlive .hit{border-bottom:.5px dashed var(--dsw-alias-border-l2);padding:5px 0}
      .dlive .hit:last-child{border-bottom:0}
      .dlive .score{float:right;font-size:11px;color:var(--dsw-alias-label-tertiary)}
      .dlive .empty{color:var(--dsw-alias-label-tertiary);padding:16px 4px;line-height:20px}
      .dlive .err{color:#d9534f}
      /* ---------------- 思考过程那一栏的美化（2026-10-29） ---------------- */
      .dlive .blk{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;margin-bottom:12px;
        background:rgba(127,127,127,.06)}
      .dlive .blk>summary{display:flex;align-items:center;gap:6px;font-weight:600;letter-spacing:.02em;
        color:var(--dsw-alias-label-secondary);cursor:pointer;list-style:none}
      .dlive .blk>summary::-webkit-details-marker{display:none}
      .dlive .blk>summary::before{content:'▸';color:#4d6bfe;font-size:11px;transition:transform .15s ease}
      .dlive .blk[open]>summary::before{transform:rotate(90deg)}
      .dlive .blk>summary:hover{color:var(--dsw-alias-label-primary)}
      .dlive .blk .body{margin-top:8px;line-height:1.78;white-space:pre-wrap;word-break:break-word}
      .dlive .meta{gap:8px !important}
      .dlive .meta .k{background:rgba(127,127,127,.14);border-radius:6px;padding:1px 7px;font-variant-numeric:tabular-nums}
      .dlive .hit{padding:8px 0}
      .dlive .score{background:rgba(77,107,254,.14);border-radius:8px;padding:1px 7px;font-variant-numeric:tabular-nums}
      .dlive .hint{margin:2px 0 10px;padding:8px 10px;border-radius:9px;font-size:11.5px;line-height:1.6;
        background:rgba(77,107,254,.10);color:var(--dsw-alias-label-secondary)}
      /* ---------------- 悬浮球（2026-10-29）：平时一个球，点开才展开 ---------------- */
      .dshell-ball{position:fixed;width:36px;height:36px;border-radius:50%;border:0;cursor:grab;touch-action:none;user-select:none;
        padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#4d6bfe;
        transition:left .2s cubic-bezier(.2,.9,.3,1.08),top .2s cubic-bezier(.2,.9,.3,1.08),transform .18s cubic-bezier(.2,.9,.3,1.1),background .12s ease,opacity .12s ease;
        background:#4d6bfe;color:#fff;font-size:13.5px;font-weight:600;letter-spacing:.02em;opacity:.94;
        box-shadow:0 4px 14px rgba(0,0,0,.28);z-index:9999;transition:transform .12s ease,background .12s ease,opacity .12s ease}
      .dshell-ball:hover{transform:translateY(-1px);opacity:1;box-shadow:0 6px 18px rgba(0,0,0,.36)}
      .dshell-ball-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;pointer-events:none}
      .dshell-ball-txt{position:relative;z-index:1;font-size:13.5px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5)}
      .dshell-ball-txt.on{font-size:20px}
      .dshell-ball.drag{transform:scale(1.06);opacity:1;box-shadow:0 8px 22px rgba(0,0,0,.42);transition:none}
      .dshell-ball.on{background:rgba(127,127,127,.62);font-size:19px;opacity:1;transform:rotate(90deg) scale(.94)}

      /* 卡片：定高 + 内部各自滚动，别让整张卡随着消息长短跳 */
      .dshell-card{position:fixed;width:min(94vw,430px);height:auto;min-height:190px;max-height:min(78vh,620px);overflow:hidden;z-index:9999;
        transform:scale(.90);opacity:0;pointer-events:none;visibility:hidden;
        transition:transform .18s cubic-bezier(.2,.9,.3,1.1),opacity .14s ease,visibility .18s;
        display:flex;flex-direction:column;gap:6px;
        background:var(--dsw-alias-bg-l1,#1b1b1f);border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;
        box-shadow:0 14px 44px rgba(0,0,0,.45);padding:10px 12px}
      .dshell-card.on{transform:scale(1);opacity:1;pointer-events:auto;visibility:visible}
      .dshell-card.drag{opacity:0;transform:scale(.94);pointer-events:none}
      .dshell-card .dlive{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:0}
      /* 会话列表：整块滚动，不把卡片撑高 */
      .dshell-card .dlive.listv{display:block;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
      /* 单条会话：对话流吃掉剩余高度，思考过程限高 */
      .dshell-card .dlive .feed{flex:1;min-height:0;width:100% !important;max-height:none}
      .dshell-card .dlive .detail{max-height:38%;overflow:auto}
      @media (max-width:520px){ .dshell-card{left:8px !important;right:8px !important;width:auto}}
      .dlive.listv{display:block}
      .dlive .page-h{display:flex;align-items:center;gap:8px;margin:2px 0 10px;font-size:12px}
      .dlive .page-h .title{font-size:13px;font-weight:600}
      .dlive .back{border:0;background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
      .dlive .back:hover{background:rgba(127,127,127,.16)}
      .dlive .sec{margin-bottom:14px}
      .dlive .sec-h{font-size:11px;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);margin:0 0 6px 2px;text-transform:uppercase}
      .dlive .trow{display:flex;gap:9px;align-items:center;width:100%;min-width:0;text-align:left;background:transparent;
        color:inherit;font:inherit;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;
        padding:8px 10px;margin-bottom:7px;cursor:pointer;overflow:hidden;transition:background .12s ease}
      .dlive .trow:hover{background:rgba(127,127,127,.12)}
      .dlive .trow:active{background:rgba(127,127,127,.2)}
      .dlive .trow-ava{position:relative;flex:0 0 auto;width:28px;height:28px;border-radius:8px;overflow:hidden;
        display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;
        background:rgba(77,107,254,.16);color:#8fa3ff}
      .dlive .trow-ava.grp{background:rgba(127,127,127,.2);color:var(--dsw-alias-label-secondary)}
      .dlive .trow-ava-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit}
      /* 这两层的 min-width:0 + overflow:hidden 是防溢出的关键：
         flex 子项默认 min-width:auto，不写就会把整行撑宽、横向滚出卡片。 */
      .dlive .trow-main{flex:1 1 auto;min-width:0;overflow:hidden}
      .dlive .trow-top{display:flex;align-items:baseline;gap:8px;min-width:0}
      .dlive .trow-name{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dlive .trow-time{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
      .dlive .trow-last{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:3px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dlive .trow-count{flex:0 0 auto;min-width:18px;text-align:center;font-size:10px;font-variant-numeric:tabular-nums;
        color:var(--dsw-alias-label-tertiary);background:rgba(127,127,127,.16);border-radius:9px;padding:1px 6px}
    `
