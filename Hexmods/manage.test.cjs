'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const api = require('./manage.cjs');
const fixtures = path.join(__dirname, 'test-artifacts');
fs.mkdirSync(fixtures, { recursive: true });
function write(root, rel, data) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
function manifest(root) {
  const files = {};
  for (const rel of Object.keys(api.inventory(root))) { const b = fs.readFileSync(path.join(root, rel)); files[rel] = { size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; }
  write(root, 'MANIFEST.json', JSON.stringify({ format: 1, app: 'fixture', files }));
}
function fixture() {
  const dir = fs.mkdtempSync(path.join(fixtures, 'case-'));
  const upstream = path.join(dir, 'base'), mod = path.join(dir, 'mod'), home = path.join(dir, 'manager');
  const text = 'const one = 1;\n\n// 分隔段\nconst middle = 2;\n\n// 第二段\nconst last = 3;\n';
  for (const root of [upstream, mod]) {
    write(root, 'package.json', '{"type":"module"}');
    write(root, 'server/index.js', text);
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  }
  manifest(upstream);
  return { dir, upstream, mod, home, text };
}
test('全清单核验失败不初始化', () => {
  const f = fixture(); write(f.upstream, 'server/index.js', '坏的基线');
  assert.throws(() => api.initialize(f), /核验失败/);
  assert.equal(fs.existsSync(path.join(f.home, 'state.json')), false);
});
test('开关、非重叠三方合并、重叠冲突保留可用树和快照', () => {
  const f = fixture();
  write(f.mod, 'server/index.js', f.text.replace('one = 1', 'one = 10'));
  write(f.mod, 'shared/added.js', 'export const mod = true;');
  const initial = api.initialize(f);
  assert.equal(initial.changes, 2);
  const off = api.build({ home: f.home, mode: 'off' });
  assert.equal(fs.readFileSync(off.entry, 'utf8'), f.text);
  assert.equal(fs.existsSync(path.join(off.cwd, 'shared/added.js')), false);
  const on = api.build({ home: f.home, mode: 'on' });
  assert.match(fs.readFileSync(on.entry, 'utf8'), /one = 10/);
  const next = path.join(f.dir, 'next'); fs.cpSync(f.upstream, next, { recursive: true });
  write(next, 'server/index.js', f.text.replace('last = 3', 'last = 30')); manifest(next);
  api.update({ home: f.home, upstream: next });
  const merged = api.build({ home: f.home, mode: 'on' });
  assert.match(fs.readFileSync(merged.entry, 'utf8'), /one = 10/);
  assert.match(fs.readFileSync(merged.entry, 'utf8'), /last = 30/);
  const before = fs.readFileSync(path.join(f.home, 'state.json'));
  const conflict = path.join(f.dir, 'conflict'); fs.cpSync(next, conflict, { recursive: true });
  write(conflict, 'server/index.js', f.text.replace('one = 1', 'one = 99').replace('last = 3', 'last = 30')); manifest(conflict);
  assert.throws(() => api.update({ home: f.home, upstream: conflict }), /三方合并冲突/);
  assert.deepEqual(fs.readFileSync(path.join(f.home, 'state.json')), before);
  assert.equal(api.resolveRuntime({ home: f.home, mode: 'on' }).cwd, merged.cwd);
  assert.equal(fs.readFileSync(off.entry, 'utf8'), f.text);
  assert.equal(fs.existsSync(initial.revision), true);
});
test('删除/修改、双新增、二进制冲突均停止；相同删除可以合并', () => {
  const dir = fs.mkdtempSync(path.join(fixtures, 'merge-')), git = api.gitPath();
  const b = Buffer.from('base'), a = Buffer.from('a'), c = Buffer.from('c');
  for (const [base, ours, theirs] of [[b, null, a], [null, a, c], [Buffer.from([0, 1]), Buffer.from([0, 2]), Buffer.from([0, 3])]]) assert.ok(api.mergeFile(git, base, ours, theirs, dir, 'binary').conflict);
  assert.equal(api.mergeFile(git, b, null, null, dir, 'gone').value, null);
});
test('common 独立合并上游；common 冲突不切换状态', () => {
  const f = fixture();
  const commonText = f.text.replace('one = 1', 'one = 10');
  write(f.mod, 'server/index.js', commonText.replace('middle = 2', 'middle = 20'));
  api.initialize(f);
  api.installCommon({ home: f.home, sources: { 'server/index.js': Buffer.from(commonText) }, compatibility: { sharedProfile: true } });
  const off = api.build({ home: f.home, mode: 'off' });
  assert.equal(fs.readFileSync(off.entry, 'utf8'), commonText);
  const next = path.join(f.dir, 'next-common'); fs.cpSync(f.upstream, next, { recursive: true });
  write(next, 'server/index.js', f.text + '\n// 新上游附加内容\n'); manifest(next);
  api.update({ home: f.home, upstream: next });
  const on = api.build({ home: f.home, mode: 'on' });
  assert.match(fs.readFileSync(on.entry, 'utf8'), /middle = 20/);
  assert.match(fs.readFileSync(on.entry, 'utf8'), /新上游附加内容/);
  const before = fs.readFileSync(path.join(f.home, 'state.json'));
  const conflict = path.join(f.dir, 'common-conflict'); fs.cpSync(next, conflict, { recursive: true });
  write(conflict, 'server/index.js', f.text.replace('one = 1', 'one = 999')); manifest(conflict);
  assert.throws(() => api.update({ home: f.home, upstream: conflict }), e => e.report.conflicts.some(c => c.layer === 'common'));
  assert.deepEqual(fs.readFileSync(path.join(f.home, 'state.json')), before);
});
test('off 除公共桥外与基线一致，不混入模组代码', () => {
  const home = __dirname, state = JSON.parse(fs.readFileSync(path.join(home, 'state.json')));
  const revDir = path.join(home, state.revision), rev = JSON.parse(fs.readFileSync(path.join(revDir, 'revision.json')));
  assert.deepEqual(Object.keys(rev.common).sort(), ['public/js/main.js', 'public/js/net.js', 'public/js/ui/stats.js', 'server/http/routes.js', 'server/localDoctor.js'].sort());
  const off = api.resolveRuntime({ mode: 'off' });
  for (const rel of Object.keys(rev.base)) if (!rev.common[rel]) assert.deepEqual(fs.readFileSync(path.join(off.cwd, rel)), fs.readFileSync(path.join(revDir, 'base', rel)), rel);
  for (const [rel, d] of Object.entries(rev.delta)) if (d.kind === 'add') assert.equal(fs.existsSync(path.join(off.cwd, rel)), false, rel);
  assert.doesNotMatch(fs.readFileSync(path.join(off.cwd, 'server/http/routes.js'), 'utf8'), /api\/announcements/);
});
test('src 显式提交增删、脏保护、已提交修改参与上游合并', () => {
  const f = fixture(); write(f.mod, 'shared/delete-me.js', 'export const old = true;');
  api.initialize(f); api.checkout({ home: f.home });
  write(path.join(f.home, 'src'), 'server/index.js', f.text.replace('one = 1', 'one = 40'));
  assert.throws(() => api.checkout({ home: f.home }), /工作区脏/);
  assert.throws(() => api.build({ home: f.home, mode: 'on' }), /工作区脏/);
  assert.throws(() => api.update({ home: f.home, upstream: f.upstream }), /工作区脏/);
  write(path.join(f.home, 'src'), 'shared/new.js', 'export const added = true;');
  assert.throws(() => api.commit({ home: f.home }), /未列入 add/);
  // 测试文件移到保留区，模拟显式删除而不丢弃现场。
  fs.renameSync(path.join(f.home, 'src/shared/delete-me.js'), path.join(f.dir, 'preserved-delete.js'));
  write(f.home, 'src-changes.json', JSON.stringify({ add: ['shared/new.js'], delete: ['shared/delete-me.js'] }));
  api.commit({ home: f.home });
  assert.equal(api.workspaceStatus({ home: f.home }).dirty, false);
  const run = api.build({ home: f.home, mode: 'on' });
  assert.match(fs.readFileSync(run.entry, 'utf8'), /one = 40/);
  assert.equal(fs.existsSync(path.join(run.cwd, 'shared/delete-me.js')), false);
  const next = path.join(f.dir, 'next-source'); fs.cpSync(f.upstream, next, { recursive: true });
  write(next, 'server/index.js', f.text.replace('last = 3', 'last = 50')); manifest(next);
  api.update({ home: f.home, upstream: next });
  assert.throws(() => api.commit({ home: f.home }), /版本过期/);
  api.checkout({ home: f.home });
  const text = fs.readFileSync(path.join(f.home, 'src/server/index.js'), 'utf8');
  assert.match(text, /one = 40/); assert.match(text, /last = 50/);
  assert.ok(fs.existsSync(path.join(f.home, 'src/shared/new.js')));
  assert.equal(fs.existsSync(path.join(f.home, 'src/shared/delete-me.js')), false);
  write(path.join(f.home, 'src'), 'launcher/forbidden.js', 'no');
  write(f.home, 'src-changes.json', JSON.stringify({ add: ['launcher/forbidden.js'], delete: [] }));
  assert.throws(() => api.commit({ home: f.home }), /超出源码范围/);
});
test('工作区扫描跳过密钥和根目录本机档案，提交不读取或包含私有数据', () => {
  const workspaceTools = require('./workspace.cjs');
  const home = path.resolve('virtual-workspace-test'), root = path.join(home, 'src');
  const content = { 'plugins/.studio-key': 'secret', 'plugins/.studio-key.bak': 'backup', 'plugins/nested/.studio-key': 'nested', 'other/.studio-key': 'other', 'server/index.js': 'changed', '.local-doctor/profile.json': 'private', '.local-doctor/nested/data.json': 'private nested', '.local-doctor-backup/profile.json': 'backup', 'other/.local-doctor/profile.json': 'other profile' };
  const originalRead = fs.readFileSync, originalReaddir = fs.readdirSync;
  const reads = [], writes = [], atomics = {};
  const entries = names => names.map(([name, directory]) => ({ name, isSymbolicLink: () => false, isDirectory: () => directory, isFile: () => !directory }));
  const directories = {
    '': entries([['plugins', true], ['other', true], ['server', true], ['.local-doctor', true], ['.local-doctor-backup', true]]),
    plugins: entries([['.studio-key', false], ['.studio-key.bak', false], ['nested', true]]),
    'plugins/nested': entries([['.studio-key', false]]),
    other: entries([['.studio-key', false], ['.local-doctor', true]]),
    'other/.local-doctor': entries([['profile.json', false]]),
    '.local-doctor-backup': entries([['profile.json', false]]),
    server: entries([['index.js', false]])
  };
  const baseline = Object.fromEntries(Object.keys(content).filter(name => name !== 'plugins/.studio-key' && !name.startsWith('.local-doctor/')).map(name => [name, 'old']));
  const helper = {
    HOME: home, ROOTS: [], FILES: [], REUSE: [],
    exists: () => true, safe: (base, name) => path.join(base, name), hash: b => b.toString(),
    json: file => file === path.join(home, 'workspace.json') ? { revision: 'old', files: baseline } : { add: [], delete: [] },
    state: () => ({ revision: 'old' }), revision: () => ({ dir: path.join(home, 'old'), base: {}, delta: {} }),
    lock: (unused, fn) => fn(), unique: () => path.join(home, 'new'), snapshot: () => {},
    changes: (base, current) => Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(current)])].filter(k => base[k] !== current[k]).map(k => [k, { kind: !current[k] ? 'delete' : !base[k] ? 'add' : 'modify', mod: current[k] || null }])),
    put: (file, data) => writes.push([file, data.toString()]), putJson: (file, data) => writes.push([file, data]),
    atomic: (file, data) => { atomics[path.basename(file)] = data; }
  };
  fs.readdirSync = dir => {
    const rel = path.relative(root, dir).split(path.sep).join('/');
    assert.ok(Object.hasOwn(directories, rel), `意外扫描 ${rel}`);
    return directories[rel];
  };
  fs.readFileSync = file => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    reads.push(rel);
    if (file === path.join(home, 'old', 'MANIFEST.json')) return Buffer.from('{}');
    assert.notEqual(rel, 'plugins/.studio-key', '不得读取密钥');
    assert.equal(rel.startsWith('.local-doctor/'), false, '不得读取本机档案');
    assert.ok(Object.hasOwn(content, rel), `意外读取 ${rel}`);
    return Buffer.from(content[rel]);
  };
  try {
    const workspace = workspaceTools(helper);
    const status = workspace.workspaceStatus();
    assert.deepEqual(Object.keys(status.changes).sort(), Object.keys(baseline).sort());
    const result = workspace.commit();
    assert.deepEqual(Object.keys(result.changes).sort(), Object.keys(baseline).sort());
    assert.deepEqual(Object.keys(atomics['workspace.json'].files).sort(), Object.keys(baseline).sort());
    assert.equal(Object.hasOwn(writes.find(([file]) => file.endsWith('revision.json'))[1].delta, 'plugins/.studio-key'), false);
    assert.equal(writes.some(([file]) => file === path.join(home, 'new', 'delta', 'plugins', '.studio-key')), false);
    assert.equal(reads.includes('plugins/.studio-key'), false);
    assert.equal(reads.some(rel => rel.startsWith('.local-doctor/')), false);
    assert.equal(Object.keys(writes.find(([file]) => file.endsWith('revision.json'))[1].delta).some(rel => rel.startsWith('.local-doctor/')), false);
    assert.equal(writes.some(([file]) => file.startsWith(path.join(home, 'new', 'delta', '.local-doctor') + path.sep)), false);
  } finally {
    fs.readFileSync = originalRead;
    fs.readdirSync = originalReaddir;
  }
});

test('start CLI 拒绝无效参数且传播子进程退出码', () => {
  const f = fixture(); write(f.upstream, 'server/index.js', 'process.exit(23);'); write(f.mod, 'server/index.js', 'process.exit(23);'); manifest(f.upstream);
  api.initialize(f); api.build({ home: f.home, mode: 'on' });
  const { spawnSync } = require('node:child_process');
  const cli = path.join(__dirname, 'manage.cjs');
  const run = args => spawnSync(process.execPath, [cli, 'start', '--home', f.home, ...args], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run(['--mode', 'on']).status, 23);
  assert.equal(run(['--mode', 'wrong']).status, 1);
  assert.equal(run(['--upstream', f.upstream]).status, 1);
  assert.equal(run(['--mode', 'on', '--mode', 'off']).status, 1);
  assert.equal(run(['--mode']).status, 1);
});
test('拒绝路径穿越清单', () => {
  const f = fixture(); write(f.upstream, 'MANIFEST.json', JSON.stringify({ format: 1, files: { '../outside': {} } }));
  assert.throws(() => api.verify(f.upstream), /不安全路径/);
});
test('真实两模式起服与 HTTP 检查；验证后关闭进程', { timeout: 60000 }, async () => {
  const results = [];
  const profile = fs.mkdtempSync(path.join(fixtures, 'shared-profile-'));
  let doctorId;
  const records = [];
  for (const mode of ['off', 'on', 'off']) {
    const r = api.resolveRuntime({ mode });
    const port = mode === 'off' ? 19371 : 19372;
    const { pathToFileURL: toUrl } = require('node:url');
    const { LOBBY_DEFAULT_VERSION } = await import(toUrl(path.join(r.cwd, 'shared/versions.js')).href);
    const announcement = { published: true, version: LOBBY_DEFAULT_VERSION, title: '临时测试公告', content: '只写测试文件' };
    const announcementFile = path.join(profile, 'announcements.json');
    write(profile, 'announcements.json', JSON.stringify({ versions: { [LOBBY_DEFAULT_VERSION]: announcement } }));
    let log = '';
    const child = spawn(process.execPath, [r.entry], { cwd: r.cwd, env: { ...process.env, ...r.env, PORT: String(port), HOST: '127.0.0.1', SP_LOCAL_PROFILE_DIR: profile, SP_HEX_ANNOUNCEMENTS: announcementFile }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 20000;
        const timer = setInterval(async () => {
          if (child.exitCode !== null || Date.now() > deadline) { clearInterval(timer); reject(Error(log)); return; }
          try { const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) }); if (res.ok) { clearInterval(timer); resolve(); } } catch {}
        }, 150);
      });
      const page = await fetch(`http://127.0.0.1:${port}/`); assert.equal(page.status, 200);
      const announcementResponse = await fetch(`http://127.0.0.1:${port}/api/announcements`);
      if (mode === 'on') { assert.equal(announcementResponse.status, 200); assert.deepEqual(await announcementResponse.json(), announcement); }
      else assert.equal(announcementResponse.status, 404);
      const profileResponse = await fetch(`http://127.0.0.1:${port}/api/local-doctor`, { headers: { 'x-sp-local-profile': '1' } });
      assert.equal(profileResponse.status, 200);
      const initial = await profileResponse.json();
      assert.equal(initial.scope, 'host');
      doctorId ||= initial.doctorId;
      assert.equal(initial.doctorId, doctorId);
      for (const rec of records) assert.deepEqual(initial.records.find(x => x.id === rec.id), rec);
      // 使用各模式实际前端归档模块，经真实 HTTP 写回，不只验证服务端 POST。
      const { pathToFileURL } = require('node:url');
      const { createDoctorArchive } = await import(pathToFileURL(path.join(r.cwd, 'public/js/net.js')).href);
      const map = new Map();
      const local = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
      const errors = [];
      const archive = createDoctorArchive({ local, fetch: (url, opts) => fetch(`http://127.0.0.1:${port}${url}`, opts), onError: e => errors.push(e) });
      const restored = await archive.init({ name: '临时双模式博士' });
      assert.equal(restored.doctorId, doctorId);
      const rec = { id: `full-${results.length}`, t: results.length + 1, v: 3, end: 'settled', selfId: 'p1', players: [{ playerId: 'p1', name: '临时博士', units: [{ id: 'unit1', equipment: ['item1'], damage: 123456 }] }], rounds: [{ round: 15, battle: { damage: 987654, events: ['完整战绩字段'] } }], result: { victory: true } };
      archive.saveName('共用博士'); archive.saveRecords([rec]); await archive.flush();
      assert.deepEqual(errors, []);
      records.push(rec);
      const saved = await (await fetch(`http://127.0.0.1:${port}/api/local-doctor`, { headers: { 'x-sp-local-profile': '1' } })).json();
      assert.equal(saved.name, '共用博士'); assert.equal(saved.doctorId, doctorId);
      for (const value of records) assert.deepEqual(saved.records.find(x => x.id === value.id), value);
      for (const rel of ['public/assets', 'public/fonts']) assert.equal(fs.realpathSync(path.join(r.cwd, rel)), fs.realpathSync(path.join(path.dirname(__dirname), rel)));
      results.push({ mode, root: page.status, announcements: announcementResponse.status, doctorApi: profileResponse.status, doctorId, total: saved.total, fullRecordsVerified: records.length });
    } finally { if (child.exitCode === null) child.kill(); await exited; write(fixtures, `startup-${mode}.log`, log); }
  }
  write(fixtures, 'smoke-results.json', JSON.stringify(results, null, 2));
});
