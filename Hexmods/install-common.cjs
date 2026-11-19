'use strict';
// 从已封存的快照提取已审查的身份存档差异，不读取个人档案或当前可变工程。
const fs = require('node:fs');
const path = require('node:path');
const api = require('./manage.cjs');
const home = __dirname;
const st = JSON.parse(fs.readFileSync(path.join(home, 'state.json')));
const rev = path.join(home, st.revision);
const read = (layer, rel) => fs.readFileSync(path.join(rev, layer, rel), 'utf8');
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error('公共桥提取锚点不唯一或已改变');
  return text.replace(before, after);
}
const sources = {};
for (const rel of ['public/js/net.js', 'public/js/main.js', 'public/js/ui/stats.js']) {
  let base = read('base', rel);
  const mod = read('delta', rel);
  if (rel.endsWith('/net.js')) {
    base = replaceOnce(base, 'saveName: (name) => sset(local, K_NAME, String(name)),', 'saveName: (name) => { sset(local, K_NAME, String(name)); if (deps.local === undefined) doctorArchive.saveName(String(name)); },');
    const start = mod.indexOf('// 永久档案与重连 token 分离。');
    const end = mod.indexOf('/** Browser identity singleton', start);
    if (start < 0 || end < 0) throw Error('身份桥边界丢失');
    base = replaceOnce(base, '/** Browser identity singleton', mod.slice(start, end) + '/** Browser identity singleton');
  } else if (rel.endsWith('/main.js')) {
    base = replaceOnce(base, 'net, identity, NetError }', 'net, identity, NetError, doctorArchive, onDoctorArchiveError }');
    base = replaceOnce(base, 'recordResult, installStatsRecorder }', 'recordResult, installStatsRecorder, migrateStats, mergeStats, saveStats }');
    const start = mod.indexOf('  onDoctorArchiveError((message)');
    const end = mod.indexOf('\n  const pendingJoin', start);
    if (start < 0 || end < 0) throw Error('启动存档桥边界丢失');
    base = replaceOnce(base, '  const identityReady = identity.init();\n', '  const identityReady = identity.init();\n' + mod.slice(start, end));
  } else {
    base = replaceOnce(base, "import { sanitizeName }", "import { doctorArchive } from '../net.js';\nimport { sanitizeName }");
    base = replaceOnce(base, 'export function migrateStats(raw) {', 'export function migrateStats(raw, limit = MAX_RECORDS) {');
    base = replaceOnce(base, 'const kept = normalized.slice(0, MAX_RECORDS);', 'const kept = normalized.slice(0, limit);');
    base = replaceOnce(base, '  if (stats.newer) return false;\n', '  if (stats.newer) return false;\n  doctorArchive.saveRecords(stats.records.filter((r) => r.test !== true));\n');
    base = replaceOnce(base, '  const { stats: next, added } = appendRecord(stats, rec);', '  doctorArchive.saveRecords([rec]);\n  const { stats: next, added } = appendRecord(stats, rec);');
    base = replaceOnce(base, 'const { stats: incoming, newer, dropped } = migrateStats(raw);', 'const { stats: incoming, newer, dropped } = migrateStats(raw, Infinity);');
    base = replaceOnce(base, '  const have = new Set((Array.isArray(current?.records)', '  doctorArchive.saveRecords(incoming.records);\n  const have = new Set((Array.isArray(current?.records)');
  }
  sources[rel] = Buffer.from(base);
}
const routes = 'server/http/routes.js';
let text = read('base', routes);
text = replaceOnce(text, "import { clientAddress, isLocalIp } from '../net.js';", "import { clientAddress, isLocalIp } from '../net.js';\nimport { createLocalDoctorStore, handleLocalDoctor } from '../localDoctor.js';");
text = replaceOnce(text, 'trustedRuntime = null }) {', 'trustedRuntime = null, localDoctor = createLocalDoctorStore() }) {');
text = replaceOnce(text, "    if (trustedRuntime && parts.rawPath.startsWith('/x/')", "    if (parts.rawPath === '/api/local-doctor') { await handleLocalDoctor(req, res, localDoctor, sendJson); return; }\n    if (trustedRuntime && parts.rawPath.startsWith('/x/')");
sources[routes] = Buffer.from(text);
sources['server/localDoctor.js'] = Buffer.from(read('delta', 'server/localDoctor.js'));
const result = api.installCommon({ sources, compatibility: {
  sharedProfile: true,
  layer: 'common',
  offException: '关闭模组明确保留公共身份与完整战绩归档桥；不包含全局设置、战斗、布局、公告等模组功能。',
  sharedAssets: ['public/assets', 'public/fonts'],
  profile: '两模式默认共用原工程 .local-doctor；SP_LOCAL_PROFILE_DIR 可指定临时目录。',
  history: '完整记录独立文件持久化；原版界面保留近期窗口，GET 返回最近1000条，磁盘完整历史不删除。',
  concurrency: '切换时先停止旧服务；不支持两个进程并发写同一档案目录。',
  merge: '原版→common→模组两级 git merge-file；任一层冲突停止。'
} });
console.log(JSON.stringify(result, null, 2));
