'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const HOME = __dirname;
const ROOT = path.dirname(HOME);
const DEFAULT_UPSTREAM = 'C:/Users/zwl/Desktop/Stronghold-Protocol';
const ROOTS = ['server', 'public', 'shared', 'data', 'packs', 'plugins', 'schemas', 'scripts', 'test', 'tools', 'docs'];
const FILES = ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'README.md', 'CHANGELOG.md'];
const REUSE = ['node_modules', 'public/assets', 'public/fonts'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = p => fs.existsSync(p);
function safe(root, name) {
  if (typeof name !== 'string' || name.includes('\\') || name.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(name) || name.includes(':')) throw Error(`不安全路径 ${name}`);
  const p = path.resolve(root, name);
  if (!p.startsWith(path.resolve(root) + path.sep)) throw Error('路径越界');
  return p;
}
function put(p, b) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); }
function putJson(p, v) { put(p, JSON.stringify(v, null, 2) + '\n'); }
function atomic(p, v) { const tmp = p + '.' + crypto.randomUUID() + '.tmp'; putJson(tmp, v); fs.renameSync(tmp, p); }
function unique(home, group) { const p = path.join(home, group, Date.now() + '-' + crypto.randomUUID()); fs.mkdirSync(p, { recursive: true }); return p; }
function gitPath() {
  const candidates = [process.env.HEXMODS_GIT, 'C:/Program Files/WorkBuddy/resources/vendor/PortableGit/mingw64/bin/git.exe', 'C:/Program Files/Git/cmd/git.exe', 'git'].filter(Boolean);
  for (let p of candidates) {
    if (p === 'git') {
      const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8', windowsHide: true });
      p = found.stdout?.trim().split(/\r?\n/)[0];
    }
    if (p && spawnSync(p, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0) return path.resolve(p);
  }
  throw Error('找不到可用 git；请设置 HEXMODS_GIT 为具体可执行路径');
}
function inventory(root) {
  const result = {};
  function walk(rel) {
    if (REUSE.includes(rel)) return;
    const full = safe(root, rel);
    if (!exists(full)) return;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error(`源码中不接受链接：${rel}`);
    if (stat.isDirectory()) {
      for (const n of fs.readdirSync(full).sort()) {
        // 本地密钥和临时状态不是模组源码，也绝不复制到可提供静态服务的运行树。
        if (n.startsWith('.') || /\.(zip|tar|gz|exe|log|tmp)$/i.test(n)) continue;
        walk(rel + '/' + n);
      }
    } else if (stat.isFile()) result[rel] = hash(fs.readFileSync(full));
  }
  [...ROOTS, ...FILES].forEach(walk);
  return result;
}
function verify(root) {
  const manifest = json(path.join(root, 'MANIFEST.json'));
  if (manifest.format !== 1 || !manifest.files) throw Error('未知 MANIFEST 格式');
  const errors = [];
  let checked = 0;
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const file = safe(root, rel);
    try {
      if (!fs.lstatSync(file).isFile()) throw Error('不是普通文件');
      const b = fs.readFileSync(file);
      if (b.length !== expected.size || hash(b) !== expected.sha256) errors.push(rel);
    } catch (e) { errors.push(`${rel}: ${e.code || e.message}`); }
    checked++;
  }
  const report = { app: manifest.app, checked, errors, manifestSha256: hash(fs.readFileSync(path.join(root, 'MANIFEST.json'))) };
  if (errors.length) { const e = Error(`基线清单核验失败：${errors.length} 项`); e.report = report; throw e; }
  return report;
}
function snapshot(root, dest, files) {
  for (const rel of Object.keys(files)) put(safe(dest, rel), fs.readFileSync(safe(root, rel)));
}
function changes(base, mod) {
  const out = {};
  for (const rel of [...new Set([...Object.keys(base), ...Object.keys(mod)])].sort()) {
    if (base[rel] !== mod[rel]) out[rel] = { kind: !mod[rel] ? 'delete' : !base[rel] ? 'add' : 'modify', base: base[rel] || null, mod: mod[rel] || null };
  }
  return out;
}
function lock(home, fn) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'operation.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw Error('已有 Hexmods 操作或残留锁；请先确认运行状态，不自动移除锁'); throw e; }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function state(home) { return json(path.join(home, 'state.json')); }
function revision(home, st = state(home)) { return { ...json(safe(home, st.revision + '/revision.json')), dir: safe(home, st.revision) }; }
function initialize({ home = HOME, upstream = DEFAULT_UPSTREAM, mod = ROOT } = {}) {
  return lock(home, () => {
    if (exists(path.join(home, 'state.json'))) throw Error('已初始化；请使用 update，原有快照不会被覆盖');
    upstream = path.resolve(upstream); mod = path.resolve(mod);
    const check = verify(upstream), base = inventory(upstream), local = inventory(mod), delta = changes(base, local);
    const dir = unique(home, 'revisions');
    snapshot(upstream, path.join(dir, 'base'), base);
    snapshot(mod, path.join(dir, 'delta'), Object.fromEntries(Object.entries(local).filter(([k]) => delta[k])));
    put(path.join(dir, 'MANIFEST.json'), fs.readFileSync(path.join(upstream, 'MANIFEST.json')));
    const r = { upstream, mod, base, delta, check, git: gitPath(), reuse: REUSE, compatibility: { sharedProfile: false, reason: '纯原版无本机档案 API 及前端同步逻辑；关闭模式不注入模组代码。开启模式通过 SP_LOCAL_PROFILE_DIR 继续使用原档案。' } };
    putJson(path.join(dir, 'revision.json'), r);
    atomic(path.join(home, 'state.json'), { revision: path.relative(home, dir).split(path.sep).join('/'), mode: 'off', active: {} });
    return { revision: dir, baseline: check, changes: Object.keys(delta).length, git: r.git, compatibility: r.compatibility };
  });
}
function readBase(r, rel) {
  return r.base[rel] ? fs.readFileSync(safe(path.join(r.dir, 'base'), rel)) : null;
}
function readCommon(r, rel) {
  const d = r.common?.[rel];
  if (d?.kind === 'delete') return null;
  return d ? fs.readFileSync(safe(path.join(r.dir, 'common'), rel)) : readBase(r, rel);
}
function readMod(r, rel) {
  const d = r.delta[rel];
  if (d?.kind === 'delete') return null;
  return d ? fs.readFileSync(safe(path.join(r.dir, 'delta'), rel)) : readCommon(r, rel);
}
function installCommon({ home = HOME, sources, compatibility } = {}) {
  return lock(home, () => {
    const st = state(home), old = revision(home, st);
    if (old.common) throw Error('common 已安装；后续使用三方 update，禁止覆盖已有层');
    const dir = unique(home, 'revisions'), combined = { ...old.base };
    for (const [rel, b] of Object.entries(sources)) combined[rel] = hash(b);
    const common = changes(old.base, combined), modHashes = {};
    const all = new Set([...Object.keys(combined), ...Object.keys(old.delta)]);
    for (const rel of all) { const b = readMod(old, rel); if (b !== null) modHashes[rel] = hash(b); }
    const delta = changes(combined, modHashes);
    snapshot(path.join(old.dir, 'base'), path.join(dir, 'base'), old.base);
    for (const rel of Object.keys(common)) put(safe(path.join(dir, 'common'), rel), sources[rel]);
    for (const [rel, d] of Object.entries(delta)) if (d.kind !== 'delete') put(safe(path.join(dir, 'delta'), rel), readMod(old, rel));
    put(path.join(dir, 'MANIFEST.json'), fs.readFileSync(path.join(old.dir, 'MANIFEST.json')));
    putJson(path.join(dir, 'revision.json'), { ...old, dir: undefined, common, delta, compatibility });
    atomic(path.join(home, 'state.json'), { ...st, revision: path.relative(home, dir).split(path.sep).join('/') });
    return { revision: dir, commonFiles: Object.keys(common), modChanges: Object.keys(delta).length };
  });
}
function equal(a, b) { return a === null ? b === null : b !== null && a.equals(b); }
function mergeFile(git, base, ours, theirs, dir, rel) {
  if (equal(ours, base)) return { value: theirs };
  if (equal(theirs, base) || equal(ours, theirs)) return { value: ours };
  if (base === null || ours === null || theirs === null || [base, ours, theirs].some(b => b.includes(0))) return { conflict: '新增/删除或二进制冲突' };
  const tmp = path.join(dir, 'merge-inputs', hash(rel));
  put(path.join(tmp, 'base'), base); put(path.join(tmp, 'ours'), ours); put(path.join(tmp, 'theirs'), theirs);
  const result = spawnSync(git, ['merge-file', '-p', '--diff3', '-L', '模组', '-L', '原基线', '-L', '新上游', path.join(tmp, 'ours'), path.join(tmp, 'base'), path.join(tmp, 'theirs')], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status === null || result.status < 0 || result.status > 127) throw Error(`git merge-file 失败：${result.error?.message || result.stderr}`);
  if (result.status !== 0) { put(safe(path.join(dir, 'conflicts'), rel), result.stdout); return { conflict: `git merge-file 返回 ${result.status}` }; }
  return { value: result.stdout };
}
function update({ home = HOME, upstream } = {}) {
  if (!upstream) throw Error('update 必须指定 --upstream 解压目录');
  return lock(home, () => {
    workspace.assertClean(home);
    const st = state(home), old = revision(home, st);
    upstream = path.resolve(upstream);
    const check = verify(upstream), next = inventory(upstream), dir = unique(home, 'revisions'), git = gitPath();
    const conflicts = [], merged = {}, commonHashes = {}, buffers = new Map(), commonBuffers = new Map();
    for (const rel of new Set([...Object.keys(old.base), ...Object.keys(old.common || {}), ...Object.keys(old.delta), ...Object.keys(next)])) {
      const b = readBase(old, rel), c = readCommon(old, rel);
      const o = readMod(old, rel), t = next[rel] ? fs.readFileSync(safe(upstream, rel)) : null;
      const shared = mergeFile(git, b, c, t, path.join(dir, 'common-merge'), rel);
      if (shared.conflict) { conflicts.push({ layer: 'common', file: rel, reason: shared.conflict }); continue; }
      if (shared.value !== null) { commonHashes[rel] = hash(shared.value); if (!equal(shared.value, t)) commonBuffers.set(rel, shared.value); }
      const result = mergeFile(git, c, o, shared.value, path.join(dir, 'mod-merge'), rel);
      if (result.conflict) { conflicts.push({ layer: 'mod', file: rel, reason: result.conflict }); continue; }
      if (result.value !== null) { merged[rel] = hash(result.value); if (!equal(result.value, shared.value)) buffers.set(rel, result.value); }
    }
    if (conflicts.length) {
      const report = { accepted: false, conflicts, upstream, previousRevision: st.revision, activeUnchanged: true };
      putJson(path.join(dir, 'conflict-report.json'), report);
      const e = Error(`三方合并冲突 ${conflicts.length} 项，可用运行树与当前基线未改变：${dir}`); e.report = report; throw e;
    }
    const common = changes(next, commonHashes), delta = changes(commonHashes, merged);
    snapshot(upstream, path.join(dir, 'base'), next);
    for (const [rel, b] of commonBuffers) put(safe(path.join(dir, 'common'), rel), b);
    for (const [rel, b] of buffers) put(safe(path.join(dir, 'delta'), rel), b);
    put(path.join(dir, 'MANIFEST.json'), fs.readFileSync(path.join(upstream, 'MANIFEST.json')));
    putJson(path.join(dir, 'revision.json'), { ...old, dir: undefined, upstream, base: next, common, delta, check, git });
    // 只有完整合并成功才切换源码版本；已有运行树继续可用，build 后才切运行树。
    atomic(path.join(home, 'state.json'), { ...st, revision: path.relative(home, dir).split(path.sep).join('/') });
    return { accepted: true, revision: dir, changes: Object.keys(delta).length, baseline: check };
  });
}
function modeValue(mode) { if (!['on', 'off'].includes(mode)) throw Error('mode 必须为 on 或 off'); return mode; }
function build({ home = HOME, mode = 'off' } = {}) {
  modeValue(mode);
  return lock(home, () => {
    workspace.assertClean(home);
    const st = state(home), r = revision(home, st);
    const currentCheck = verify(r.upstream);
    if (currentCheck.manifestSha256 !== r.check.manifestSha256) throw Error('上游目录已改变，请先 update；不能混用旧源码和新依赖');
    const dest = unique(home, 'runs');
    // 外部共享目录属于只读输入；构建器从不写入、chmod 或执行安装命令。
    const files = new Set([...Object.keys(r.base), ...Object.keys(r.common || {}), ...(mode === 'on' ? Object.keys(r.delta) : [])]);
    let count = 0;
    for (const rel of files) {
      const data = mode === 'on' ? readMod(r, rel) : readCommon(r, rel);
      if (data === null) continue;
      const expected = (mode === 'on' && r.delta[rel]?.mod) || r.common?.[rel]?.mod || r.base[rel];
      if (hash(data) !== expected) throw Error(`快照哈希发生变化：${rel}`);
      put(safe(dest, rel), data); count++;
    }
    const links = [];
    for (const rel of REUSE) {
      // 两模式明确共享现有大型素材；依赖仍跟随上游。只复用资源，不引入模组逻辑。
      // 优先游戏根目录内的真实目录：与 healReuse 查找顺序一致，且分发包搬到别的机器后仍能指向包内资源，
      // 不再把构建机的外部绝对路径（如桌面上游工程）写进运行树。
      const target = [path.join(ROOT, rel), safe(r.mod, rel), safe(r.upstream, rel)].find(p => exists(p));
      if (!target) { if (rel === 'node_modules') throw Error('缺少 node_modules'); continue; }
      const link = safe(dest, rel);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      links.push({ path: rel, target, usage: '只读复用；目录链接不是操作系统写保护' });
    }
    const check = spawnSync(process.execPath, ['--check', path.join(dest, 'server/index.js')], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw Error(`运行入口语法检查失败：${check.stderr}`);
    putJson(path.join(dest, 'hexmods-build.json'), { mode, revision: st.revision, files: count, links });
    // 记录相对路径，发布包换机后仍可解析；旧版本绝对路径由 resolveRunDir 兜底。
    const entry = { dir: path.relative(home, dest).split(path.sep).join('/'), revision: st.revision };
    atomic(path.join(home, 'state.json'), { ...st, mode, active: { ...st.active, [mode]: entry } });
    return resolveRuntime({ home, mode });
  });
}
function resolveRuntime({ home = HOME, mode } = {}) {
  const st = state(home); mode = modeValue(mode || st.mode);
  const active = st.active?.[mode];
  if (!active || active.revision !== st.revision) throw Error(`请先 build --mode ${mode}，该模式尚未构建当前源码版本`);
  const r = revision(home, st);
  const dir = resolveRunDir(home, active.dir);
  if (!dir || !exists(path.join(dir, 'server/index.js'))) {
    throw Error('运行树入口丢失：请确认 Hexmods/runs 完整，或重新 build。发布包若被移动过，请用随包的 Hexmods 目录运行。');
  }
  // 发布包/搬家后，素材与依赖的目录链接会失效；按游戏根目录内的真实目录自动重建。
  const healed = healReuse(home, dir, r);
  const gameRoot = ROOT;
  return {
    mode,
    cwd: dir,
    entry: path.join(dir, 'server/index.js'),
    env: {
      SP_LOCAL_PROFILE_DIR: process.env.SP_LOCAL_PROFILE_DIR || path.join(gameRoot, '.local-doctor'),
      ...(mode === 'on' ? { SP_HEX_ANNOUNCEMENTS: process.env.SP_HEX_ANNOUNCEMENTS || path.join(gameRoot, 'launcher', 'announcements.json') } : {}),
    },
    healed,
    compatibility: r.compatibility,
  };
}
// 运行树目录可能是历史绝对路径（换机/换路径后失效），按 runs 下的同名目录找回。
function resolveRunDir(home, dir) {
  if (typeof dir !== 'string' || !dir) return null;
  if (path.isAbsolute(dir)) {
    if (exists(path.join(dir, 'server/index.js'))) return dir;
    const recovered = path.join(home, 'runs', path.basename(dir));
    return exists(path.join(recovered, 'server/index.js')) ? recovered : dir;
  }
  try { return safe(home, dir); } catch { return null; }
}
// 只重建链接，不复制也不写入共享目录；目标缺失时留给调用方报错。
function healReuse(home, dir, r) {
  const healed = [];
  for (const rel of REUSE) {
    const link = safe(dir, rel);
    let alive = false;
    try { alive = fs.statSync(link).isDirectory(); } catch { alive = false; }
    if (alive) continue;
    const target = [path.join(ROOT, rel), safe(r.mod, rel), safe(r.upstream, rel)].find(p => exists(p));
    if (!target) continue;
    try { if (fs.lstatSync(link)) fs.rmSync(link, { recursive: true, force: true }); } catch { /* 不存在即忽略 */ }
    try {
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      healed.push({ path: rel, target });
    } catch { /* 权限不足时保持缺失，由启动检查报告 */ }
  }
  return healed;
}
function status({ home = HOME } = {}) { const st = state(home), r = revision(home, st); return { ...st, git: r.git, baseline: r.check, changes: Object.keys(r.delta).length, compatibility: r.compatibility }; }
const workspace = require('./workspace.cjs')({ HOME, ROOTS, FILES, REUSE, safe, hash, json, exists, put, putJson, atomic, unique, lock, state, revision, readMod, readCommon, snapshot, changes });
module.exports = { initialize, installCommon, verify, update, build, resolveRuntime, status, gitPath, mergeFile, inventory, ...workspace };
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2), opts = {};
  try {
    const allowed = { init: ['home', 'upstream', 'mod'], build: ['home', 'mode'], update: ['home', 'upstream'], resolve: ['home', 'mode'], start: ['home', 'mode'], status: ['home'], verify: ['upstream'], checkout: ['home'], commit: ['home'], 'workspace-status': ['home'] };
    if (!allowed[cmd]) throw Error('命令：init | checkout | workspace-status | commit | build | update | resolve | start | status | verify');
    if (args.length % 2) throw Error('参数需要 --名称 值');
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].startsWith('--') ? args[i].slice(2) : '';
      if (!allowed[cmd].includes(key) || Object.hasOwn(opts, key) || args[i + 1].startsWith('--')) throw Error(`无效或重复参数 ${args[i]}`);
      opts[key] = args[i + 1];
    }
    if (cmd === 'start') {
      const runtime = resolveRuntime(opts);
      const child = spawn(process.execPath, [runtime.entry], { cwd: runtime.cwd, env: { ...process.env, ...runtime.env }, stdio: 'inherit', windowsHide: true });
      child.on('error', e => { console.error(e.message); process.exitCode = 1; });
      let requestedSignal;
      const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { requestedSignal = signal; child.kill(signal); }]));
      child.on('exit', (code, signal) => {
        for (const [name, handler] of handlers) process.removeListener(name, handler);
        process.exitCode = requestedSignal ? (requestedSignal === 'SIGINT' ? 130 : 143) : (code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
      });
      for (const [signal, handler] of handlers) process.on(signal, handler);
    } else {
      const fn = { init: initialize, checkout: workspace.checkout, commit: workspace.commit, 'workspace-status': workspace.workspaceStatus, build, update, resolve: resolveRuntime, status, verify: o => verify(o.upstream || DEFAULT_UPSTREAM) }[cmd];
      if (!fn) throw Error('命令：init | build --mode on/off | update --upstream 目录 | resolve --mode on/off | start --mode on/off | status | verify');
      console.log(JSON.stringify(fn(opts), null, 2));
    }
  } catch (e) { console.error(JSON.stringify({ error: e.message, report: e.report }, null, 2)); process.exitCode = 1; }
}
