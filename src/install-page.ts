import { loadCatalog, searchEvents } from "./catalog.js";

const eventCount = searchEvents(loadCatalog().events, { limit: 1, city: "all" }).total_matches;

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function installPage(origin: string): string {
  const mcpUrl = `${origin}/mcp`;
  const codex = `codex mcp add tech-week --url ${mcpUrl}`;
  const claude = `claude mcp add --transport http tech-week ${mcpUrl}`;
  const config = JSON.stringify({ mcpServers: { "tech-week": { url: mcpUrl } } }, null, 2);
  const cursorConfig = JSON.stringify({ url: mcpUrl });
  const cursorUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=tech-week&config=${encodeURIComponent(base64Utf8(cursorConfig))}`;

  const examplePrompts = [
    "“Find Thursday hardware events”",
    "“Find evening events in SoMa”",
    "“Look at my Tuesday calendar for events in my free time”",
    "“Build me a Friday itinerary”",
    "“What's happening Wednesday afternoon?”",
    "“Find events like the a16z kickoff”",
  ];

  const favicon =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%8C%89%3C/text%3E%3C/svg%3E";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#e5eef5">
  <meta name="description" content="Tech Week MCP is deprecated. SF and LA Tech Week 2026 are over; this read-only MCP server now serves a frozen, historical snapshot of the 2026 calendars and is no longer updated.">
  <title>Tech Week MCP (deprecated)</title>
  <link rel="icon" href="${favicon}">
  <style>
    :root{
      color-scheme:light;
      --label:#000;--label-2:rgba(60,60,67,.72);--label-3:rgba(60,60,67,.5);
      --tint:#007aff;--green:#34c759;
      --fill:rgba(120,120,128,.16);--fill-2:rgba(120,120,128,.12);
      --hairline:rgba(0,0,0,.1);
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro","Segoe UI",Roboto,ui-sans-serif,system-ui,sans-serif;
      background:#e5eef5;color:var(--label);
    }
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:max(env(safe-area-inset-top),24px) 18px max(env(safe-area-inset-bottom),24px);background:transparent;overflow-x:hidden;-webkit-font-smoothing:antialiased}
    /* Match the canvas Safari samples, blending the artwork into its chrome. */
    .background{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:44% center;z-index:0;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 85%,transparent);mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 85%,transparent)}
    main{position:relative;z-index:2;width:100%;max-width:520px;min-width:0}
    /* Layered glass with a soft body and reflective edges. */
    .card{
      position:relative;
      isolation:isolate;
      background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(255,255,255,.68) 42%,rgba(245,249,255,.7) 75%,rgba(255,255,255,.76));
      backdrop-filter:blur(36px) saturate(1.65);
      -webkit-backdrop-filter:blur(36px) saturate(1.65);
      border:1px solid rgba(255,255,255,.16);
      border-radius:28px;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 12px 36px rgba(24,40,58,.09);
      padding:24px 22px 18px;
    }
    .card{animation:card-reveal 1.5s ease .45s backwards}
    .card.revealed{animation:none}
    @keyframes card-reveal{from{opacity:0}to{opacity:1}}
    @media(prefers-reduced-motion:reduce){.card{animation:none}}
    .card::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;background:radial-gradient(ellipse at 0 0,rgba(255,255,255,.48),transparent 55%),radial-gradient(ellipse at 100% 100%,rgba(255,255,255,.2),transparent 45%)}
    @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.card{background:rgba(245,248,252,.94)}}
    /* Hierarchy: one clear focal title, quiet supporting copy */
    h1{margin:0 0 6px;text-align:center;font-weight:700;font-size:clamp(1.55rem,5vw,2rem);line-height:1.13;letter-spacing:.004em;color:var(--label)}
    .prompts{margin:2px auto 20px;max-width:100%;min-height:1.6em;min-width:0;display:flex;align-items:center;justify-content:center;text-align:center}
    .prompts .stream{color:#45454f;font-size:clamp(.9rem,2.2vw,1rem);font-weight:450;line-height:1.35;letter-spacing:-.01em;display:block;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .32s ease}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
    @media(prefers-reduced-motion:reduce){.prompts .stream{transition:none}}
    /* Consistency: a segmented control, the platform-native way to switch modes */
    .tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin:0 0 16px;padding:3px;background:linear-gradient(135deg,rgba(255,255,255,.38),rgba(220,230,242,.18));backdrop-filter:blur(12px) saturate(1.4);-webkit-backdrop-filter:blur(12px) saturate(1.4);border:1px solid rgba(255,255,255,.5);border-radius:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -1px 0 rgba(255,255,255,.2),0 2px 8px rgba(24,40,58,.06)}
    .client{position:relative;display:flex;align-items:center;justify-content:center;min-height:34px;border:0;border-radius:9px;background:transparent;padding:0 4px;color:var(--label);font-family:inherit;font-size:13px;font-weight:590;line-height:1;letter-spacing:-.01em;text-decoration:none;cursor:pointer;white-space:nowrap;transition:background .18s ease}
    .client:not(:last-child)::before{content:"";position:absolute;right:-2px;top:6px;bottom:6px;width:1px;background:rgba(60,60,67,.18);transition:opacity .18s ease}
    .client[aria-selected="true"]::before,.client[aria-selected="true"]+.client::before{opacity:0}
    @media(hover:hover){.client:hover:not([aria-selected="true"]){background:rgba(255,255,255,.3)}}
    .client[aria-selected="true"]{background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(255,255,255,.88));color:#000;box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 0 0 1px rgba(255,255,255,.65),0 3px 8px rgba(24,40,58,.2)}
    .client:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
    .cursor-tab::after{content:"\\2197";font-size:.75em;margin-left:4px;opacity:.5}
    /* Command: a terminal-style panel with a clear primary action */
    .command{border:.5px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(48,50,58,.88);overflow:hidden}
    .cmd-titlebar{display:flex;align-items:center;gap:7px;padding:11px 14px;border-bottom:.5px solid rgba(255,255,255,.1)}
    .cmd-titlebar i{width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,.22)}
    .cmd-titlebar i:first-child{background:#ff5f57}
    .cmd-titlebar i:nth-child(2){background:#febc2e}
    .cmd-titlebar i:nth-child(3){background:#28c840}
    .cmd-titlebar span{margin-left:6px;color:rgba(235,235,245,.5);font-family:inherit;font-size:.6875rem;font-weight:590;letter-spacing:.04em}
    .cmd-body{position:relative;display:flex;gap:8px;padding:14px 16px}
    .cmd-body::after{display:none;content:"";position:absolute;top:0;right:0;bottom:0;width:24px;background:linear-gradient(90deg,transparent,rgba(48,50,58,.92));pointer-events:none}
    .command.has-overflow:not(.is-config) .cmd-body::after{display:block}
    .prompt{flex:0 0 auto;color:var(--green);font:600 .9rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
    .command.is-config .prompt{display:none}
    pre#install-command{margin:0;flex:1 1 auto;min-width:0;color:#f5f5f7;font:500 .875rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}
    .command.is-config pre#install-command{white-space:pre-wrap;overflow-wrap:anywhere}
    pre#install-command::-webkit-scrollbar{height:4px}
    pre#install-command::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:2px}
    .copy{display:block;width:100%;border:0;border-top:.5px solid rgba(255,255,255,.12);padding:14px;background:var(--tint);color:#fff;font-family:inherit;font-size:.9375rem;font-weight:600;line-height:1;letter-spacing:-.01em;cursor:pointer;transition:background .15s ease}
    .copy:active{background:#0067d6}
    .copy:focus-visible{outline:2px solid var(--tint);outline-offset:-3px}
    .github-link{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:16px auto -10px;color:#45454f;border-radius:50%;transition:background .18s ease,color .18s ease}
    .github-link:hover{background:rgba(255,255,255,.6);color:#000}
    .github-link:focus-visible{outline:2px solid var(--tint);outline-offset:2px}
    .copy.ok{background:var(--green)}
    .tabs{border-color:rgba(255,255,255,.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 2px 6px rgba(24,40,58,.04)}
    .client[aria-selected="true"]{box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 2px 5px rgba(24,40,58,.1)}
    .github-link{margin-top:10px;margin-bottom:-6px}
    .site-footer{margin-top:12px;text-align:center;color:#45454f;font-size:.6875rem;line-height:1.5;text-wrap:balance}
    .site-footer p{margin:0}
    .deprecation-banner{margin:0 0 14px;padding:10px 14px;border-radius:12px;background:rgba(255,204,0,.22);border:1px solid rgba(178,134,0,.35);color:#3d2f00;font-size:.8125rem;line-height:1.45;text-align:center;text-wrap:balance}
    .deprecation-banner strong{font-weight:700}
    .event-count{margin:8px 0 10px;text-align:center;color:#45454f;font-size:.8125rem;line-height:1.4}
    @media(max-width:380px){.card{padding-inline:16px}.prompts .stream{font-size:.8125rem}}
    @media(min-width:520px){.tabs{grid-template-columns:repeat(4,1fr)}}
    /* Honor the iOS "Reduce Transparency" accessibility setting */
    @media(prefers-reduced-transparency:reduce){
      .tabs{background:#e2e6eb;backdrop-filter:none;-webkit-backdrop-filter:none}
      .client[aria-selected="true"]{background:#fff}
      .card{background:rgba(255,255,255,.97);backdrop-filter:none;-webkit-backdrop-filter:none}
      .card::before{display:none}
      .command{background:#30323a}
      .cmd-body::after{background:linear-gradient(90deg,transparent,#30323a)}
    }
  </style>
</head>
<body>
  <img class="background" src="/golden-gate-watercolor.png" alt="" aria-hidden="true" fetchpriority="high">
  <main>
    <div class="card">
      <p class="deprecation-banner" role="status"><strong>Deprecated.</strong> SF and LA Tech Week 2026 are over. This server is kept online as a read-only archive of the 2026 calendars and is no longer updated, so it has no live event coverage.</p>
      <h1>Tech Week MCP</h1>
      <p class="event-count">Archive of ${eventCount.toLocaleString("en-US")} past events</p>
      <p class="sr-only">Example prompts you can ask your AI coding client once the MCP is installed.</p>
      <p class="prompts" aria-hidden="true"><span class="stream"></span></p>
      <div class="tabs" role="tablist" aria-label="Choose your client (archival install)">
        <button class="client" id="tab-codex" role="tab" aria-selected="true" tabindex="0" data-client="codex" aria-label="Codex CLI">Codex</button>
        <button class="client" id="tab-claude" role="tab" aria-selected="false" tabindex="-1" data-client="claude" aria-label="Claude Code CLI">Claude</button>
        <a class="client cursor-tab" id="tab-cursor" role="tab" aria-selected="false" tabindex="-1" href="${escapeHtml(cursorUrl)}" aria-label="Install in Cursor (opens the Cursor app)">Cursor</a>
        <button class="client" id="tab-config" role="tab" aria-selected="false" tabindex="-1" data-client="config" aria-label="Configuration for other clients">Other</button>
      </div>
      <div class="command">
        <div class="cmd-titlebar" aria-hidden="true"><i></i><i></i><i></i><span>zsh</span></div>
        <div class="cmd-body"><span class="prompt" aria-hidden="true">$</span><pre id="install-command" tabindex="0" aria-label="Installation command">${escapeHtml(codex)}</pre></div>
        <button class="copy" id="copy" type="button">Copy command</button>
      </div>
      <a class="github-link" href="https://github.com/abishakkodi/tech-week-mcp" target="_blank" rel="noopener noreferrer" aria-label="SF Tech Week MCP repository on GitHub (opens in a new tab)" title="GitHub">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.467-1.332-5.467-5.93 0-1.31.467-2.38 1.235-3.22-.123-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 6.098c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.654 1.653.242 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.625-5.479 5.922.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      </a>
      <footer class="site-footer">
        <p>Not affiliated with or endorsed by a16z or Tech Week.</p>
      </footer>
    </div>
  </main>
  <script>
    const values={codex:${scriptJson(codex)},claude:${scriptJson(claude)},config:${scriptJson(config)}};
    const cmd=document.getElementById('install-command');
    const command=document.querySelector('.command');
    const card=document.querySelector('.card');
    if(card){
      const markRevealed=()=>card.classList.add('revealed');
      card.addEventListener('animationend',markRevealed,{once:true});
      if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)markRevealed();
    }
    function updateOverflow(){command.classList.toggle('has-overflow',cmd.scrollWidth-cmd.clientWidth-cmd.scrollLeft>2);}
    cmd.addEventListener('scroll',updateOverflow,{passive:true});
    new ResizeObserver(updateOverflow).observe(cmd);
    const tabs=Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function focusOnly(tab){tabs.forEach((t)=>{const on=t===tab;t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});}
    const copyBtn=document.getElementById('copy');
    function select(tab){focusOnly(tab);const key=tab.dataset.client;if(!key)return;cmd.textContent=values[key];cmd.scrollLeft=0;const isConfig=key==='config';document.querySelector('.cmd-titlebar span').textContent=isConfig?'JSON':'zsh';command.classList.toggle('is-config',isConfig);updateOverflow();copyBtn.dataset.label=isConfig?'Copy config':'Copy command';copyBtn.classList.remove('ok');copyBtn.textContent=copyBtn.dataset.label;}
    tabs.forEach((tab)=>{
      tab.addEventListener('click',(event)=>{if(tab.dataset.client){event.preventDefault();select(tab);tab.focus();}});
      tab.addEventListener('keydown',(event)=>{
        if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
        event.preventDefault();
        const step=event.key==='ArrowRight'?1:tabs.length-1;
        const next=tabs[(tabs.indexOf(tab)+step)%tabs.length];
        next.focus();
        if(next.dataset.client)select(next);else focusOnly(next);
      });
    });
    function wireCopy(button,getText){
      button.addEventListener('click',async()=>{
        const label=button.dataset.label||button.textContent;
        button.dataset.label=label;
        try{await navigator.clipboard.writeText(getText());button.textContent='Copied';button.classList.add('ok');}
        catch(error){button.textContent='Copy failed';}
        setTimeout(()=>{button.textContent=label;button.classList.remove('ok');},1500);
      });
    }
    wireCopy(document.getElementById('copy'),()=>cmd.textContent);
    const PROMPTS=${scriptJson(examplePrompts)};
    const promptWrap=document.querySelector('.prompts');
    const streamEl=promptWrap&&promptWrap.querySelector('.stream');
    const reduceMotion=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(streamEl){
      const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
      if(reduceMotion){
        let p=0;streamEl.textContent=PROMPTS[0];
        setInterval(()=>{p=(p+1)%PROMPTS.length;streamEl.textContent=PROMPTS[p];},6500);
      }else{
        streamEl.textContent='';
        (async function run(){
          if(card)await Promise.all(card.getAnimations().map((animation)=>animation.finished.catch(()=>{})));
          let p=0;
          for(;;){
            const text=PROMPTS[p];
            streamEl.textContent='';
            for(let i=0;i<text.length;i++){
              streamEl.textContent+=text[i];
              await sleep(/[.,?!]/.test(text[i])?150:16+Math.random()*46);
            }
            await sleep(4500);
            streamEl.style.opacity='0';
            await sleep(340);
            streamEl.textContent='';
            streamEl.style.opacity='';
            p=(p+1)%PROMPTS.length;
            await sleep(200);
          }
        })();
      }
    }
  </script>
</body>
</html>`;
}
