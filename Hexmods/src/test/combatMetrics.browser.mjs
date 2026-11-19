// 独立统计面板浏览器验收夹具，不启动游戏服务器、不连接用户会话。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chessRec, enemyRec, flatStage, flatRoutes } from './helpers/battleHarness.js';
import { buildBattleSpec } from '../server/sim/spec.js';

const workerData = Object.fromEntries(['chess','enemies','tokens','stages','waves','bonds','items','garrisons','bands','effects','backups'].map(key => [key, {}]));
workerData.chess.meter_op = chessRec({ id: 'meter_op', skill: null, stats: { maxHp: 2000, atk: 20, def: 0, hpRecoveryPerSec: 30, bat: .1 } });
workerData.enemies.meter_enemy = enemyRec({ key: 'meter_enemy', hp: 100000, atk: 80, bat: .1, speed: 0, range: 2 });
workerData.stages.meter_stage = flatStage({ id: 'meter_stage' });
const workerSpec = buildBattleSpec({ battleId: 'browser_metrics', fieldId: 'f1', stageId: 'meter_stage', seed: 27,
  timeLimit: 3, content: 'generic', flags: { startOpCooldown: 0 }, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    units: [{ uid: 1, kind: 'chess', chessId: 'meter_op', row: 9, col: 5 }] }],
  routes: flatRoutes(), spawns: [{ time: 0, enemyKey: 'meter_enemy', routeIndex: 0, pos: [9, 6] }] });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DPS 统计面板独立验收</title>
<link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/game.css">
<style>body{margin:0;min-height:100vh;background:var(--bg-0)}#report{font:14px monospace;padding:12px;max-width:90vw;white-space:pre-wrap}.gm__gear{min-width:44px;min-height:44px}.gm__metrics-label{font-size:14px}</style>
<textarea id="report" aria-label="验收结果" readonly style="width:90vw;height:36vh">正在载入真实统计组件</textarea><div id="app"></div>
<script>for(const kind of ['error','unhandledrejection'])addEventListener(kind,e=>{document.querySelector('#report').value=String(e.reason?.stack||e.error?.stack||e.message);});</script>
<script type="module">
import {h,render} from '/vendor/preact.module.js';
import {useState} from '/vendor/hooks.module.js';
import {html} from '/js/ui/components.js';
import {CombatMetricsPanel} from '/js/ui/combatMetrics.js';
const sourceRows = [
 {key:'a',ownerId:'p1',name:'伤害干员',kind:'op',defId:'meter_a',damage:900,healing:10,taken:30,types:{phys:600,arts:100,true:100,elemental:100}},
 {key:'b',ownerId:'p1',name:'治疗干员',kind:'op',defId:'meter_b',damage:20,healing:800,taken:10,types:{phys:20,arts:0,true:0,elemental:0}},
 {key:'c',ownerId:'p1',name:'承伤干员',kind:'op',defId:'meter_c',damage:10,healing:20,taken:700,types:{phys:10,arts:0,true:0,elemental:0}},
 ...Array.from({length:12},(_,i)=>({key:'r'+i,ownerId:'p1',name:'测试干员'+i,kind:'op',defId:'row_'+i,damage:i,healing:i,taken:i,types:{phys:i,arts:0,true:0,elemental:0}}))
];
import {WorkerSimHost,InPageSimHost} from '/js/battle/simHost.js';
import {combineCombat} from '/js/battle/metrics.js';
let reads=0, lastTrusted='',workerStatus='未启用';
let remote=null;
if(new URLSearchParams(location.search).has('worker')){
 try{
  const {data,spec}=await (await fetch('/metrics-fixture')).json();
  remote=new WorkerSimHost();
  const local=await new InPageSimHost().load('browser-test',{data});
  await remote.load('browser-test',{cs:'browser-test',data});
  local.start(spec);await remote.start(spec);
  for(let i=0;i<12;i++){local.step(8);await remote.step(8);}
  workerStatus=JSON.stringify(remote.combatMetrics())===JSON.stringify(local.combatMetrics())?'真实浏览器 Worker 与页内三项一致':'三项不一致';
  remote.stop();local.stop();
 }catch(error){workerStatus=error.stack||error.message;remote?.stop();remote=null;}
}
const runner={combatMetrics({scope}){reads++;if(remote)return combineCombat([remote.combatMetrics()],'p1');const factor=scope==='match'?2:scope==='last'?.5:1;return {rows:sourceRows.map(r=>({...r,damage:r.damage*factor,healing:r.healing*factor,taken:r.taken*factor,types:Object.fromEntries(Object.entries(r.types).map(([k,v])=>[k,v*factor]))})),damage:996*factor,healing:896*factor,taken:806*factor,unsupported:false};}};
// APP_SOURCE
</script></html>`;

// 模板在服务端替换，夹具始终使用生产组件与样式。
const appSource = "function App(){const[open,setOpen]=useState(new URLSearchParams(location.search).has('open'));return html`<div class=\"gm__corner\">${open?html`<${CombatMetricsPanel} myId=\"p1\" runner=${runner} onClose=${()=>setOpen(false)}/>`:null}<button class=\"gm__gear gm__metrics\" aria-label=\"作战统计\" aria-expanded=${open} onClick=${()=>setOpen(!open)}><span class=\"gm__metrics-label\">DPS</span></button></div>`;}\nrender(h(App),document.querySelector('#app'));\ndocument.addEventListener('click',e=>{lastTrusted=String(e.isTrusted)+' '+(document.elementFromPoint(e.clientX,e.clientY)?.closest('button')?.textContent||'');},true);\nsetInterval(()=>{const p=document.querySelector('.combat-metrics'),list=p?.querySelector('ol'),r=p?.getBoundingClientRect();const buttons=[...document.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {text:b.textContent.trim(),pressed:b.getAttribute('aria-pressed'),x:Math.round(q.x+q.width/2),y:Math.round(q.y+q.height/2),hit:document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)?.closest('button')===b};});document.querySelector('#report').value=JSON.stringify({viewport:[innerWidth,innerHeight],open:!!p,reads,lastTrusted,workerStatus,workerTotals:remote?combineCombat([remote.combatMetrics()],'p1'):null,buttons,first:list?.querySelector('b')?.textContent,total:p?.querySelector('.combat-metrics__totals')?.textContent,inViewport:r?r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth:null,scrollable:list?[list,p.querySelector('.combat-metrics__body')].some(e=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY!=='visible'):null,hasRates:p?/HPS|DPS/.test(p.textContent):null},null,2);},250);";
const htmlPage = page.replace('// APP_SOURCE', () => appSource);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/data.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end("import {getSimData} from '/sim/simdata.js'; export function getData(){return getSimData()||{};} export function resetData(){}");
      return;
    }
    if (url.pathname === '/metrics-fixture') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: workerData, spec: workerSpec }));
      return;
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const size = /^(375x812|768x1024|1440x900|844x390)$/.exec(url.searchParams.get('size') || '');
      if (size) { const [w, h] = size[0].split('x'); res.end(`<iframe title="统计尺寸验收" src="/?open=1" style="width:${w}px;height:${h}px;border:0"></iframe>`); }
      else res.end(htmlPage);
      return;
    }
    const route = decodeURIComponent(url.pathname);
    const dir = route.startsWith('/shared/') ? root : route.startsWith('/sim/') ? path.join(root, 'server') : path.join(root, 'public');
    const file = path.resolve(dir, '.' + route);
    if (!file.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(3147, '127.0.0.1', () => console.log('统计独立验收 http://127.0.0.1:3147'));
