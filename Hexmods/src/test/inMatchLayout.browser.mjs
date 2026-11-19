// 独立验收：真实 iframe viewport + 内存 Match HTTP intent；不启动正式游戏服或 WebSocket。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Match } from '../server/match/Match.js';
import { getVersionData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { validateC2S } from '../shared/protocol.js';
import { PHASE, ERR } from '../shared/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = path.resolve(root, '../..');
const port = Number(process.env.PORT || 3154);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效端口');
const version = 'act3autochess@V3_1';
const gameData = getVersionData(version, { log: { warn() {}, error() {} } });
const bands = Object.values(gameData.bands);
const rewardKey = 'refresh_shop_count_gain_coin_bond_char_chess';
const passiveBand = bands.find(b => b.buffs?.some(x => x.key === rewardKey));
const skills = bands.flatMap(b => (b.skills || []).map(s => ({ ...s, bandId: b.bandId })));
const choices = {
  passive: passiveBand.skills[0],
  active: skills.find(s => s.type === 'ACTIVE' && s.targetType === 'NO_TARGET'),
  targeted: skills.find(s => s.type === 'ACTIVE' && s.targetType === 'SHOP_SLOT'),
  locked: bands.find(b => b.skills?.[0]?.type === 'NONE')?.skills[0],
};
const sessions = new Map(), reports = new Map(), history = [];
let latestReport = null;
const scope = '仅内存 Match 的准备阶段 HTTP intent：真实 C2S 校验、Match.handle、privateView；初始资金/策略/免费刷新为夹具种子。不包含正式 WebSocket、房间、登录或完整对局。';
function createFixture(kind = 'passive', scenario = 'normal') {
  if (!choices[kind]) throw new Error('未知指令类型');
  const sent = [];
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 11, version,
    scheduler: new VirtualScheduler(), data: gameData,
    seats: [{ seat: 0, playerId: 'fixture-p1', name: '验收一', connected: true },
      { seat: 1, playerId: 'fixture-p2', name: '验收二', connected: true }],
    send(playerId, message) { sent.push({ playerId, type: message.t }); if (sent.length > 24) sent.shift(); },
    broadcast() {}, onEnd() {} });
  match.round = 1; match.phase = PHASE.PREP;
  match.disabledBonds = []; match.staticInactiveBonds = []; match.bondChoice = null;
  const ps = match.players.get('fixture-p1');
  const skill = choices[kind];
  ps.bandId = kind === 'passive' ? passiveBand.bandId : bands.find(b => b.skills?.some(s => s.effectId === skill.effectId)).bandId;
  ps.funds = scenario === 'cap9' ? 135 : 30;
  ps.recompute(); ps.shop.freeRefreshes = 3; ps.rollShop();
  return { match, ps, sent, kind, scenario, intents: [], touched: Date.now() };
}
function session(run) {
  let f = sessions.get(run);
  if (!f) {
    if (sessions.size >= 24) {
      const oldest = [...sessions].sort((a, b) => a[1].touched - b[1].touched)[0];
      oldest[1].match.dispose(); sessions.delete(oldest[0]);
    }
    f = createFixture(); sessions.set(run, f);
  }
  f.touched = Date.now(); return f;
}
function snapshot(f) {
  return { transport: 'http-memory-match', scope, kind: f.kind, scenario: f.scenario,
    phase: f.match.phase, round: f.match.round, priv: f.ps.privateView(),
    progress: f.ps.bandProgressView(), refreshes: f.ps.round.refreshes,
    gainedChess: f.ps.round.gainedChess, intents: f.intents, sent: f.sent };
}
const allowedIntents = new Set(['g.buySlot', 'g.refresh', 'g.freeze', 'g.levelUp', 'g.buy', 'g.command']);
function intent(f, message) {
  const invalid = validateC2S(message);
  let result;
  if (invalid) result = { error: 'INVALID_C2S', detail: invalid };
  else if (!allowedIntents.has(message.t)) result = { error: 'FIXTURE_INTENT_NOT_ALLOWED' };
  else result = f.match.handle('fixture-p1', message);
  f.intents.push({ message, result }); if (f.intents.length > 32) f.intents.shift();
  return { result, ...snapshot(f) };
}
function serverChecks() {
  const checks = [], fixtures = [];
  const make = (scenario = 'normal') => { const f = createFixture('passive', scenario); fixtures.push(f); return f; };
  const check = (name, pass, actual) => checks.push({ name, pass: !!pass, actual });
  try {
    const f = make(), cap = f.ps.deployCap;
    check('初始资金 30', f.ps.funds === 30, f.ps.funds);
    const buy = intent(f, { t: 'g.buySlot', rid: 1 });
    check('真实买位扣 15 并增加 1 位', buy.result.ok && buy.priv.funds === 15 && buy.priv.deployCap === cap + 1 && buy.priv.shop.deploySlotBought === 1,
      { result: buy.result, funds: buy.priv.funds, deployCap: buy.priv.deployCap, bought: buy.priv.shop.deploySlotBought });
    intent(f, { t: 'g.buySlot', rid: 2 });
    const poor = intent(f, { t: 'g.buySlot', rid: 3 });
    check('资金不足拒绝且不额外扣费', poor.result.error === ERR.NO_FUNDS && poor.priv.funds === 0 && poor.priv.shop.deploySlotBought === 2, poor.result);
    const invalid = intent(f, { t: 'g.buySlot', rid: -1 });
    check('真实 C2S 拒绝负请求编号', invalid.result.error === 'INVALID_C2S', invalid.result);
    const g = make('cap9'), base = g.ps.deployCap;
    const buys = Array.from({ length: 9 }, (_, i) => intent(g, { t: 'g.buySlot', rid: i + 1 }).result);
    const tenth = intent(g, { t: 'g.buySlot', rid: 10 });
    check('整局累计 9 位上限及第 10 次拒绝', buys.every(r => r.ok) && tenth.result.error === ERR.MAX_DEPLOY_SLOTS
      && tenth.priv.shop.deploySlotBought === 9 && tenth.priv.deployCap === base + 9 && tenth.priv.funds === 0,
      { bought: tenth.priv.shop.deploySlotBought, funds: tenth.priv.funds, result: tenth.result });
    const h = make(), progress = [];
    for (let i = 0; i < 4; i++) { const r = intent(h, { t: 'g.refresh', rid: i + 1 }); progress.push({ result: r.result, progress: r.progress, gainedChess: r.gainedChess }); }
    check('贾维前三次刷新仅累计进度', progress.slice(0, 3).every((r, i) => r.result.ok && r.progress.progress.current === i + 1 && r.gainedChess === 0), progress.slice(0, 3));
    check('贾维第四次刷新奖励 1 干员', progress[3].result.ok && progress[3].gainedChess === 1 && progress[3].progress.roundProgress.current === 1
      && progress[3].progress.progress.current === 0 && h.ps.funds === 29, { ...progress[3], funds: h.ps.funds });
    for (let i = 0; i < 4; i++) intent(h, { t: 'g.refresh' });
    check('同回合奖励上限不重复发放', h.ps.round.gainedChess === 1 && h.ps.bandProgressView().nextRewardRefreshes === null, h.ps.bandProgressView());
    h.match.phase = PHASE.COMBAT;
    const wrongPhase = intent(h, { t: 'g.buySlot' });
    check('非准备阶段拒绝购买', wrongPhase.result.error === ERR.WRONG_PHASE, wrongPhase.result);
    return { scope, pass: checks.every(c => c.pass), checks };
  } finally { fixtures.forEach(f => f.match.dispose()); }
}

// 从当前入口读取完整 CSS 顺序，包含 devices / ui-theme；不启动入口脚本。
const index = await readFile(path.join(root, 'public/index.html'), 'utf8');
const cssLinks = [...index.matchAll(/<link\b[^>]*href="(\/(?:css|fonts)\/[^"?]+\.css)"[^>]*>/g)].map(m => m[1]);
const styleLinks = [...new Set(cssLinks)].map(href => '<link rel="stylesheet" href="' + href + '">').join('\n');
const shell = String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>真实 iframe 布局验收</title>
<style>html{overflow-y:scroll;overflow-x:hidden}html,body{margin:0;background:#101b18;color:#e1eee7;font:13px system-ui}header{padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}button,a{font:13px system-ui}a{color:#9de2c0}#stage{position:relative;overflow:hidden;margin:0 8px;background:#132d29}iframe{position:absolute;left:0;top:0;border:0;transform-origin:top left;display:block}#summary{margin:8px;white-space:pre-wrap}details{margin:8px}#report{white-space:pre-wrap;overflow-wrap:anywhere}textarea{box-sizing:border-box;width:100%;height:180px;background:#09120f;color:#ddd}#scope{padding:0 10px}#sync{color:#9de2c0}</style></head><body>
<header><b>真实 iframe viewport</b><a href="?vp=1920x1080">1920×1080</a><a href="?vp=1280x720">1280×720</a><a href="?vp=960x540">960×540</a><button data-action="passive">贾维被动</button><button data-action="active">主动指令</button><button data-action="targeted">目标指令</button><button data-action="locked">锁定指令</button><button data-action="remote">切换观战</button><button data-action="collapse">收起展开</button><button data-action="reset">重置资金30</button><button data-action="cap9">资金135买位上限</button><button data-action="checks">运行服务端检查</button><button data-action="report">重新报告</button><span id="sync">等待 frame</span><a id="raw">HTTP JSON 报告</a><a id="direct">直接打开 frame</a></header>
<p id="scope">主题参数只覆盖 ShopBar 的 data-reg-theme，不代表导入主题包；CSS 按 public/index.html 完整加载。内层使用 theme.css 的真实 viewport 根字号。外层仅缩放 iframe 显示。</p><div id="stage"></div><pre id="summary" aria-live="polite">等待真实 frame 回报</pre><details><summary>完整 JSON 报告（pre / textarea）</summary><pre id="report">等待回报</pre><textarea id="report-text" readonly aria-label="完整验收报告">等待回报</textarea></details>
<script>
const q=new URLSearchParams(location.search), spec=/^(\d+)x(\d+)$/.exec(q.get('vp')||'1920x1080');
const width=spec?Math.max(320,Math.min(7680,Number(spec[1]))):1920,height=spec?Math.max(240,Math.min(4320,Number(spec[2]))):1080;
const run=q.get('run')||crypto.randomUUID();q.set('run',run);q.set('vp',width+'x'+height);history.replaceState(null,'','?'+q);
const frame=document.createElement('iframe');frame.title='真实游戏验收视口';frame.width=width;frame.height=height;frame.style.width=width+'px';frame.style.height=height+'px';
const fq=new URLSearchParams(q);fq.set('frame','1');frame.src='/?'+fq;
document.querySelector('#stage').append(frame);document.querySelector('#raw').href='/report?run='+encodeURIComponent(run);document.querySelector('#direct').href=frame.src;
function fit(){const scale=Math.min(1,(document.documentElement.clientWidth-16)/width,Math.max(160,innerHeight-230)/height);frame.style.transform='scale('+scale+')';const stage=document.querySelector('#stage');stage.style.width=(width*scale)+'px';stage.style.height=(height*scale)+'px';}
addEventListener('resize',fit);fit();
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const m=e.data;if(m.type==='fixture-report'){const r=m.report,text=JSON.stringify(r,null,2);document.querySelector('#report').textContent=text;const ta=document.querySelector('#report-text');ta.textContent=text;ta.value=text;
document.querySelector('#summary').textContent=JSON.stringify({run:r.run,sequence:r.sequence,viewport:r.viewport,rootFont:r.rootFont,expectedViewport:[width,height],viewportMatches:r.viewport[0]===width&&r.viewport[1]===height,theme:r.theme,themeScope:r.themeScope,fonts:r.fonts,css:r.css,command:r.command,commandInNativeSlot:r.commandInNativeSlot,sameSize:r.sameSize,hit:r.hit,toolbarFits:r.toolbarFits,clipped:r.clipped,textOverflow:r.textOverflow,overlaps:r.overlaps,funds:r.match?.funds,bought:r.match?.bought,progress:r.match?.progress,lastTrusted:r.lastTrusted,tooltip:r.tooltip,errors:r.errors,checks:r.checks?{pass:r.checks.pass}:null},null,2);
}else if(m.type==='fixture-sync')document.querySelector('#sync').textContent=m.ok?'已 POST /report #'+m.sequence:'报告 POST 失败：'+m.error;});
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>frame.contentWindow.postMessage({type:'fixture-control',action:b.dataset.action},location.origin)));
</script></body></html>`;

const framePage = String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>局内真实 viewport frame</title>
${styleLinks}
<style>:root{--sa-b:0px;--sa-l:0px;--sa-r:0px}body{margin:0}.gm__field{background:repeating-linear-gradient(45deg,#132d29 0 50px,#16342e 50px 100px)}#fixture-report{position:fixed;left:8px;top:90px;max-height:40vh;max-width:45vw;overflow:auto;z-index:9999;background:#101b18;font:12px monospace}#fixture-report:not([open]){opacity:.6}#fixture-json{white-space:pre-wrap}#fixture-text{width:40vw;height:120px}</style></head><body>
<div id="app"></div><details id="fixture-report"><summary>验收报告 /report</summary><pre id="fixture-json">正在加载</pre><textarea id="fixture-text" readonly aria-label="frame验收报告">正在加载</textarea><button id="capture">重新报告</button></details>
<script>
(()=>{const q=new URLSearchParams(location.search),run=q.get('run')||crypto.randomUUID();let sequence=0,chain=Promise.resolve();const errors=[];
window.fixtureBridge={run,errors,publish(report){report={...report,run,sequence:++sequence,at:new Date().toISOString(),frame:location.search,viewport:[innerWidth,innerHeight],rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),errors:[...errors]};const text=JSON.stringify(report,null,2);document.querySelector('#fixture-json').textContent=text;const ta=document.querySelector('#fixture-text');ta.textContent=text;ta.value=text;window.fixtureReport=report;if(parent!==window)parent.postMessage({type:'fixture-report',report},location.origin);
chain=chain.then(async()=>{try{const response=await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:text});if(!response.ok)throw Error('HTTP '+response.status);if(parent!==window)parent.postMessage({type:'fixture-sync',ok:true,sequence:report.sequence},location.origin);}catch(e){if(parent!==window)parent.postMessage({type:'fixture-sync',ok:false,error:String(e)},location.origin);}});return report;}};
for(const type of ['error','unhandledrejection'])addEventListener(type,e=>{errors.push(String(e.reason?.stack||e.error?.stack||e.message||e.target?.src||e.target?.href||'资源加载失败'));if(errors.length>16)errors.shift();window.fixtureBridge.publish({status:'error'});},true);
})();
</script>
<script type="module">
import {h,render} from '/vendor/preact.module.js';
import {useEffect,useRef,useState} from '/vendor/hooks.module.js';
import {html,UiHosts} from '/js/ui/components.js';
import {BandCommand} from '/js/ui/bandCommand.js';
import {EffectsList} from '/js/ui/effectsList.js';
import {TopBar} from '/js/ui/hud.js';
import {ShopBar} from '/js/ui/shopBar.js';
import {FullscreenButton} from '/js/ui/device.js';
import {data} from '/js/data.js';
import {net} from '/js/net.js';
import {PHASE} from '/shared/constants.js';
const q=new URLSearchParams(location.search), bridge=window.fixtureBridge, run=bridge.run;
const theme=q.get('theme'), themeScope=theme===null?'useSettings 的原生主题选择':'仅覆盖 .shopbar--reg[data-reg-theme] 的 CSS 分支；不声明主题包导入验收';
await data.loadAll('config','bands','effects','assets','local','chess','items','bonds','backups');
let state=null,applyState=()=>{},controls=()=>{},checks=null,rid=0;
const requests=[],pointerEvents=[];let lastTrusted=null;
async function api(route,body){const r=await fetch(route+(route.includes('?')?'&':'?')+'run='+encodeURIComponent(run),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json();if(!r.ok)throw Error(v.error||'HTTP '+r.status);return v;}
async function reset(kind=q.get('kind')||'passive',scenario='normal'){state=await api('/match/reset',{kind,scenario});applyState(state);scheduleReport('reset');}
net.request=async(t,p={})=>{const message={...p,t,rid:++rid};const next=await api('/intent',message);state=next;applyState(next);requests.push({message,result:next.result});if(requests.length>24)requests.shift();scheduleReport('intent');if(next.result.error){const e=Error(next.result.detail||next.result.error);e.code=next.result.error;throw e;}return{t:'ok',rid:message.rid};};
function send(t,p){void net.request(t,p).catch(e=>{scheduleReport('intent-rejected');});}
function applyTheme(){if(theme===null)return;const bar=document.querySelector('.shopbar--reg');if(bar){if(theme&&bar.getAttribute('data-reg-theme')!==theme)bar.setAttribute('data-reg-theme',theme);else if(!theme&&bar.hasAttribute('data-reg-theme'))bar.removeAttribute('data-reg-theme');}}
let timer=null;const reasons=new Set();
function scheduleReport(reason='event'){reasons.add(reason);if(timer!==null)return;timer=setTimeout(()=>{timer=null;applyTheme();capture();},160);}
function App(){const barRef=useRef(null),[snap,setSnap]=useState(state),[remote,setRemote]=useState(false),[collapsed,setCollapsed]=useState(false);applyState=setSnap;
 useEffect(()=>{applyTheme();scheduleReport('render');});
 controls=async action=>{if(['passive','active','targeted','locked'].includes(action))await reset(action);else if(action==='reset')await reset(snap.kind);else if(action==='cap9')await reset('passive','cap9');else if(action==='remote')setRemote(v=>!v);else if(action==='collapse')setCollapsed(v=>!v);else if(action==='checks'){checks=await api('/checks',{});}scheduleReport(action);};
 const priv=snap.priv,command=priv.command,effects=priv.effects||[];
 const commandTile=!remote&&!collapsed&&command?html\`<\${BandCommand} command=\${command} priv=\${priv} view=\${null} editable=\${true} effect=\${effects.find(e=>e.command===true)}/>\`:null;
 return html\`<div class="screen gm gm--reg"><div class="gm__field"></div><div class="gm__hud">
 <\${TopBar} pub=\${{phase:PHASE.COMBAT,round:snap.round,players:[]}} priv=\${priv} hud=\${{dp:30}} conn=\${{status:'online'}} onExit=\${()=>{}} onDrawer=\${()=>{}} onReady=\${()=>{}} />
 <div class="gm__effects"><\${EffectsList} hexPicks=\${[{name:'文火猛炖',rarity:'彩'},{name:'产能不足喵',rarity:'银'},{name:'真得苟住',rarity:'金'}]} effects=\${remote?effects.map(e=>({...e,name:'队友：'+e.name})):effects} ownCommandId=\${remote||collapsed?null:command?.effectId}/></div>
 <\${ShopBar} priv=\${priv} editable=\${!remote} collapsed=\${collapsed} barRef=\${barRef} commandTile=\${commandTile} onCollapse=\${setCollapsed} onBuy=\${slot=>send('g.buy',{slot})} onLevel=\${()=>send('g.levelUp')} onRefresh=\${()=>send('g.refresh')} onFreeze=\${()=>send('g.freeze')} onBuySlot=\${()=>send('g.buySlot')} onDetail=\${()=>{}} />
 <div class="gm__corner"><button class="gm__gear">交流</button><button class="gm__gear">设置</button><button class="gm__gear">书</button><\${FullscreenButton} class="gm__gear gm__fs"/><button class="gm__gear gm__metrics">DPS</button></div>
 </div></div><\${UiHosts}/>\`;
}
const rect=el=>{if(!el)return null;const b=el.getBoundingClientRect();return{x:b.x,y:b.y,left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
const box=s=>rect(document.querySelector(s));
const contains=(a,b)=>a&&b&&b.left>=a.left-1&&b.right<=a.right+1&&b.top>=a.top-1&&b.bottom<=a.bottom+1;
const overlap=(a,b)=>a&&b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
const label=el=>el?String(el.tagName.toLowerCase()+'.'+[...el.classList].join('.')):null;
function hitTest(el){const b=rect(el);if(!b||b.width<=0||b.height<=0)return null;return [[.5,.5],[.2,.2],[.8,.8]].map(([x,y])=>{const point=[b.left+b.width*x,b.top+b.height*y],hit=document.elementFromPoint(...point);return{point,hit:label(hit),inside:!!hit&&el.contains(hit)};});}
function clipping(el){const b=rect(el),out=[];if(!b||!b.width||!b.height)return out;if(!contains({left:0,top:0,right:innerWidth,bottom:innerHeight},b))out.push('viewport');for(let p=el.parentElement;p&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p),r=rect(p);if((/hidden|clip|scroll|auto/.test(s.overflowX)&&(b.left<r.left-1||b.right>r.right+1))||(/hidden|clip|scroll|auto/.test(s.overflowY)&&(b.top<r.top-1||b.bottom>r.bottom+1)))out.push(label(p));}return out;}
function textMetrics(el){const b=rect(el),style=getComputedStyle(el),range=document.createRange();range.selectNodeContents(el);const lines=[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));const owner=rect(el.closest('button')||el);return{element:label(el),text:el.textContent.trim(),bounds:b,scroll:[el.scrollWidth,el.scrollHeight],client:[el.clientWidth,el.clientHeight],overflow:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1,glyphOutsideButton:lines.some(r=>!contains(owner,r)),lineHeight:style.lineHeight,fontSize:style.fontSize};}
function capture(){
 const selectors=['.band-command','.shopbar__remain','.toolbtn--ice','.toolbtn--amber'];
 const toolbar=selectors.map(sel=>{const el=document.querySelector(sel);return{sel,bounds:rect(el),hit:hitTest(el),clipping:el?clipping(el):[],text:el?.textContent,disabled:el?.getAttribute('aria-disabled'),nativeDisabled:el?.disabled};});
 const c=box('.band-command'),f=box('.toolbtn--ice'),bar=box('.shopbar'),dp=box('.dpbox'),band=box('.gtop__band');
 const overlaps=[];for(let i=0;i<toolbar.length;i++)for(let j=i+1;j<toolbar.length;j++)if(overlap(toolbar[i].bounds,toolbar[j].bounds))overlaps.push([toolbar[i].sel,toolbar[j].sel]);
 const texts=[...document.querySelectorAll('.toolbtn__lbl,.toolbtn__note,.toolbtn__value,.remain__lbl,.remain__sub,.remain__val,.band-command__text b,.band-command__text small,.band-command__count')].filter(el=>el.getBoundingClientRect().width>0).map(textMetrics);
 const icons=[...document.querySelectorAll('.band-command__avatar img,.band-command__avatar svg,.band-command__avatar .band-icon,.toolbtn__face svg,.toolbtn__face img')].map(el=>({element:label(el),bounds:rect(el),src:el.currentSrc||el.getAttribute('src'),loaded:el.tagName==='IMG'?el.complete&&el.naturalWidth>0:null,viewBox:el.getAttribute('viewBox'),display:getComputedStyle(el).display,color:getComputedStyle(el).color}));
 const tooltips=[...document.querySelectorAll('[role="tooltip"],.tooltip')].filter(el=>el.getBoundingClientRect().width>0).map(el=>({text:el.textContent,bounds:rect(el),clipping:clipping(el)}));
 const css=[...document.querySelectorAll('link[rel="stylesheet"]')].map(el=>({href:new URL(el.href).pathname,loaded:!!el.sheet}));
 const presentation=window.frameElement?{iframe:rect(window.frameElement),scale:window.frameElement.getBoundingClientRect().width/innerWidth,parentViewport:[parent.innerWidth,parent.innerHeight]}:null;
 const report={status:'ready',reasons:[...reasons],presentation,rootFontSource:'public/css/theme.css；未写入根字号或舞台宽高',requestedViewport:q.get('vp'),themeScope,theme:document.querySelector('.shopbar--reg')?.getAttribute('data-reg-theme')||null,css,fonts:document.fonts.status,
  command:document.querySelector('.band-command')?.textContent||null,commandCenter:c?[c.x+c.width/2,c.y+c.height/2]:null,commandInNativeSlot:!!document.querySelector('.shopbar__tools > .shopbar__command .band-command'),commandDisabled:document.querySelector('.band-command')?.getAttribute('aria-disabled'),
  nativeGrid:(()=>{const el=document.querySelector('.shopbar__tools');if(!el)return null;const s=getComputedStyle(el);return{display:s.display,columns:s.gridTemplateColumns,rows:s.gridTemplateRows,bounds:rect(el)};})(),
  hit:toolbar[0].hit?.[0]?.inside??null,toolbar,sameWidth:c&&f?Math.abs(c.width-f.width)<1:null,sameHeight:c&&f?Math.abs(c.height-f.height)<1:null,sameSize:c&&f?Math.abs(c.width-f.width)<1&&Math.abs(c.height-f.height)<1:null,
  aboveFreeze:c&&f?c.bottom<=f.top+1:null,overlaps,clipped:toolbar.filter(x=>x.clipping.length).map(x=>({sel:x.sel,ancestors:x.clipping})),textOverflow:texts.filter(x=>x.overflow||x.glyphOutsideButton),texts,icons,
  snowflake:{count:document.querySelectorAll('.toolbtn--ice .toolbtn__face svg').length,bounds:box('.toolbtn--ice .toolbtn__face svg'),insideButton:contains(f,box('.toolbtn--ice .toolbtn__face svg'))},
  progressTitle:document.querySelector('.band-command__count')?.title,commandCount:document.querySelector('.band-command__count')?.textContent,freeText:document.querySelector('.toolbtn--amber .toolbtn__note')?.textContent,remainText:document.querySelector('.shopbar__remain')?.textContent,
  noteInsideButton:[...document.querySelectorAll('.toolbtn__note')].every(el=>contains(rect(el.closest('button')),rect(el))),noteOverlapsLabel:overlap(box('.toolbtn--amber .toolbtn__note'),box('.toolbtn--amber .toolbtn__lbl')),remainLinesOverlap:overlap(box('.remain__lbl'),box('.remain__sub')),
  tooltip:tooltips,aimPieces:document.querySelectorAll('.cmd-aim i').length,targetHighlights:document.querySelectorAll('.is-command-target').length,targets:[...document.querySelectorAll('[data-shop-slot]')].map(el=>({slot:el.dataset.shopSlot,bounds:rect(el),highlight:el.classList.contains('is-command-target')})),
  requests:[...requests],pointerEvents:[...pointerEvents],lastTrusted,dpBesideLp:dp&&band?dp.left>=band.right&&dp.top<band.bottom&&dp.bottom>band.top:false,dpCount:document.querySelectorAll('.dpbox').length,effects:document.querySelectorAll('.effect').length,
  noOverflow:document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight,documentSize:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  toolbarFits:bar?{bounds:bar,withinViewport:contains({left:0,top:0,right:innerWidth,bottom:innerHeight},bar),toolsInsideBar:toolbar.filter(x=>x.bounds?.width).every(x=>x.bounds.left>=bar.left-1&&x.bounds.right<=bar.right+1),toolsInsideGrid:toolbar.filter(x=>x.bounds?.width).every(x=>contains(box('.shopbar__tools'),x.bounds))}:null,
  match:state?{scope:state.scope,transport:state.transport,kind:state.kind,phase:state.phase,topBarPreviewPhase:PHASE.COMBAT,funds:state.priv.funds,bought:state.priv.shop.deploySlotBought,deployCap:state.priv.deployCap,progress:state.progress,refreshes:state.refreshes,gainedChess:state.gainedChess,freeRefreshes:state.priv.shop.freeRefreshes}:null,checks};
 reasons.clear();bridge.publish(report);
}
for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(type,e=>{pointerEvents.push({type,id:e.pointerId,trusted:e.isTrusted,target:label(e.target),point:[e.clientX,e.clientY]});if(pointerEvents.length>16)pointerEvents.shift();scheduleReport(type);},true);
document.addEventListener('click',e=>{lastTrusted={trusted:e.isTrusted,text:e.target.closest('button')?.textContent||null,point:[e.clientX,e.clientY],hit:label(document.elementFromPoint(e.clientX,e.clientY))};scheduleReport('click');},true);
for(const type of ['pointerover','pointerout','focusin','focusout'])document.addEventListener(type,()=>{scheduleReport(type);},true);
addEventListener('resize',()=>scheduleReport('viewport-resize'));
addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='fixture-control')return;Promise.resolve(controls(e.data.action)).catch(error=>{bridge.errors.push(String(error.stack||error));scheduleReport('control-error');});});
document.querySelector('#capture').addEventListener('click',()=>scheduleReport('manual'));
await reset();render(h(App),document.querySelector('#app'));
new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('#fixture-report')&&(r.type==='childList'||r.attributeName!=='style')))scheduleReport('dom-state');}).observe(document.querySelector('#app'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','aria-disabled','aria-busy','data-reg-theme']});
new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('[role="tooltip"],.tooltip,.cmd-aim')||n.querySelector?.('[role="tooltip"],.tooltip')))))scheduleReport('tooltip-or-aim');}).observe(document.body,{childList:true,subtree:true});
document.fonts.ready.then(()=>scheduleReport('fonts-ready'));
document.addEventListener('load',e=>{if(e.target.tagName==='IMG')scheduleReport('image-loaded');},true);
scheduleReport('ready');setTimeout(()=>scheduleReport('settled'),1200);
</script></body></html>`.replaceAll('\\`', '`').replaceAll('\\${', '${');

async function bodyJson(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 512 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 }); }
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('无效 JSON'), { status: 400 }); }
}
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value, null, 2)); }
const versionFiles = new Set(['bands.json','effects.json','config.json','bonds.json','chess.json','items.json','backups.json','enemies.json','garrisons.json','choices.json','tokens.json','waves.json','stages.json','bosses.json','factions.json']);
const mime = { '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.ogg':'audio/ogg', '.mp3':'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const run = url.searchParams.get('run') || 'default';
    if (!/^[\w-]{1,100}$/.test(run)) return json(res, { error:'无效 run' }, 400);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
      return res.end(url.searchParams.get('frame') === '1' ? framePage : shell);
    }
    if (url.pathname === '/health') return json(res, { pid:process.pid, port, scope, sessions:sessions.size, reports:reports.size, latest:latestReport?{run:latestReport.run,sequence:latestReport.sequence,receivedAt:latestReport.receivedAt}:null });
    if (url.pathname === '/report' && req.method === 'POST') {
      const report = await bodyJson(req);
      if (!/^[\w-]{1,100}$/.test(report.run || '') || !Number.isInteger(report.sequence) || !Array.isArray(report.viewport)) return json(res, { error:'无效报告' }, 400);
      const saved = { ...report, receivedAt:new Date().toISOString() };
      reports.delete(report.run); reports.set(report.run, saved);
      if (reports.size > 64) reports.delete(reports.keys().next().value);
      latestReport = saved; history.push(saved); if (history.length > 64) history.shift();
      return json(res, { ok:true, run:saved.run, sequence:saved.sequence });
    }
    if (url.pathname === '/report' && req.method === 'GET') {
      if (url.searchParams.get('history') === '1') return json(res, history.filter(r => !url.searchParams.has('run') || r.run === run));
      const report = url.searchParams.has('run') ? reports.get(run) : latestReport;
      return json(res, report || { error:'尚未收到浏览器报告', run }, report ? 200 : 404);
    }
    if (url.pathname === '/checks' && ['GET','POST'].includes(req.method)) return json(res, serverChecks());
    if (url.pathname === '/match' && req.method === 'GET') return json(res, snapshot(session(run)));
    if (url.pathname === '/match/reset' && req.method === 'POST') {
      const { kind='passive', scenario='normal' } = await bodyJson(req);
      if (!choices[kind] || !['normal','cap9'].includes(scenario)) return json(res, { error:'无效夹具场景' }, 400);
      session(run); const next = createFixture(kind, scenario); sessions.get(run).match.dispose(); sessions.set(run, next);
      return json(res, snapshot(next));
    }
    if (url.pathname === '/intent' && req.method === 'POST') return json(res, intent(session(run), await bodyJson(req)));
    if (req.method !== 'GET') return json(res, { error:'不支持的方法' }, 405);
    const route = decodeURIComponent(url.pathname);
    const rel = route.startsWith('/data/') && versionFiles.has(path.basename(route)) ? 'data/versions/act3autochess-v3_1/' + path.basename(route)
      : route.startsWith('/shared/') || route.startsWith('/data/') ? route.slice(1) : 'public' + route;
    let base = root, file = path.resolve(base, rel);
    // 源码树不包含素材大目录；只对 fonts/assets 读取游戏根目录的现有资源。
    if (route.startsWith('/assets/') || route.startsWith('/fonts/')) { base = gameRoot; file = path.resolve(base, 'public' + route); }
    if (!file.startsWith(base + path.sep)) return json(res, { error:'禁止越界路径' }, 403);
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(content);
  } catch (error) { json(res, { error:error.code === 'ENOENT' ? '资源不存在' : error.message }, error.status || (error.code === 'ENOENT' ? 404 : 500)); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ pid:process.pid, port, url:'http://127.0.0.1:'+port+'/?vp=1920x1080', report:'http://127.0.0.1:'+port+'/report', scope })));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { sessions.forEach(f => f.match.dispose()); server.close(); });
