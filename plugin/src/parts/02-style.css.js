const CSS = `
      .dher{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px;font-size:13px}
      .dher h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
      .dher .sub{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:19px;margin:0}
      .dher .tabs{display:flex;gap:8px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding-bottom:10px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-base, transparent)}
      .dher .tab{padding:6px 14px;border-radius:8px;border:.5px solid transparent;background:transparent;cursor:pointer;font-size:13px;color:var(--dsw-alias-text-2);transition:all .12s}
      .dher .tab:hover{background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1)}
      .dher .tab.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12));border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-text-1);font-weight:600}
      .dher .card{margin-top:14px}
      .dher .tab{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);
        border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer}
      .dher .tab.on{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-weight:600}
      .dher .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .dher .stat{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px}
      .dher .stat b{display:block;font-size:20px;line-height:28px;font-weight:600}
      .dher .stat span{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dher .card{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px}
      .dher .card>h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;
        color:var(--dsw-alias-label-tertiary);text-transform:uppercase}
      .dher .row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:.5px dashed var(--dsw-alias-border-l2)}
      .dher .row:last-child{border-bottom:0}
      .dher .muted{color:var(--dsw-alias-label-tertiary)}
      .dher .chip{border-radius:999px;padding:1px 9px;font-size:11.5px;border:.5px solid var(--dsw-alias-border-l2)}
      .dher .chip.on{background:var(--dsw-alias-bg-l2);font-weight:600}
      .dher .chip.off{opacity:.45}
      .dher .chip.good{background:rgba(46,160,67,.18);border-color:rgba(63,185,80,.55);color:#3fb950;font-weight:600}
      .dher .chip.bad{background:rgba(217,83,79,.16);border-color:rgba(217,83,79,.5);color:#e5534b;font-weight:600}
      .dher input{flex:1;min-width:180px;background:transparent;color:var(--dsw-alias-label-primary);
        border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:13px}
      .dher button.go{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
        border-radius:8px;padding:6px 12px;font-size:12.5px;cursor:pointer}
      .dher .err{color:#d9534f}
      .dher code{font-size:11.5px;background:var(--dsw-alias-bg-l2);padding:1px 5px;border-radius:4px}
    `
