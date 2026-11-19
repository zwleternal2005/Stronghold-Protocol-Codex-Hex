'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function workspaceTools(h) {
  const { HOME, ROOTS, FILES, REUSE, safe, hash, json, exists, put, putJson, atomic, unique, lock, state, revision, readMod, readCommon, snapshot, changes } = h;
  function scan(root, rel = '', out = {}) {
    if (!exists(root)) return out;
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const name = rel ? rel + '/' + entry.name : entry.name;
      if (name === 'plugins/.studio-key' || name === '.local-doctor') continue;
      const file = safe(root, name);
      if (entry.isSymbolicLink()) throw Error(`src 不接受链接：${name}`);
      if (entry.isDirectory()) scan(root, name, out);
      else if (entry.isFile()) out[name] = hash(fs.readFileSync(file));
      else throw Error(`不支持的源码项：${name}`);
    }
    return out;
  }
  function plan(home) {
    const value = json(path.join(home, 'src-changes.json'));
    if (!Array.isArray(value.add) || !Array.isArray(value.delete) || Object.keys(value).some(k => !['add', 'delete'].includes(k))) throw Error('src-changes.json 只接受 add/delete 数组');
    for (const k of ['add', 'delete']) {
      if (new Set(value[k]).size !== value[k].length) throw Error('增删列表不能重复');
      for (const rel of value[k]) safe(path.join(home, 'src'), rel);
    }
    return value;
  }
  function workspaceStatus({ home = HOME } = {}) {
    const file = path.join(home, 'workspace.json');
    if (!exists(file)) return { initialized: false, dirty: false };
    const meta = json(file), current = scan(path.join(home, 'src')), operations = plan(home);
    const diff = changes(meta.files, current);
    return { initialized: true, revision: meta.revision, currentRevision: state(home).revision, dirty: Object.keys(diff).length > 0 || operations.add.length > 0 || operations.delete.length > 0, changes: diff, operations };
  }
  function assertClean(home) { if (workspaceStatus({ home }).dirty) throw Error('src 工作区脏；请先 commit，不覆盖未提交源码'); }
  function checkout({ home = HOME } = {}) {
    return lock(home, () => {
      assertClean(home);
      const st = state(home), r = revision(home, st), src = path.join(home, 'src');
      if (exists(src) && !exists(path.join(home, 'workspace.json'))) throw Error('已有未登记 src，拒绝覆盖');
      const staging = unique(home, 'workspace-staging'), files = {};
      for (const rel of new Set([...Object.keys(r.base), ...Object.keys(r.common || {}), ...Object.keys(r.delta)])) {
        const data = readMod(r, rel); if (data === null) continue;
        put(safe(staging, rel), data); files[rel] = hash(data);
      }
      if (exists(src)) fs.renameSync(src, path.join(unique(home, 'workspace-archives'), 'src'));
      fs.renameSync(staging, src);
      atomic(path.join(home, 'workspace.json'), { revision: st.revision, files });
      atomic(path.join(home, 'src-changes.json'), { add: [], delete: [] });
      return { directory: src, files: Object.keys(files).length, revision: st.revision };
    });
  }
  function commit({ home = HOME } = {}) {
    return lock(home, () => {
      const ws = workspaceStatus({ home });
      if (!ws.initialized) throw Error('请先 checkout');
      if (ws.revision !== ws.currentRevision) throw Error('src 版本过期；保留改动并先同步工作区，不允许覆盖新版本');
      const st = state(home), old = revision(home, st), files = scan(path.join(home, 'src'));
      const { add, delete: deleted } = ws.operations;
      for (const [rel, d] of Object.entries(ws.changes)) {
        if (d.kind === 'add' && !add.includes(rel)) throw Error(`新增文件未列入 add：${rel}`);
        if (d.kind === 'delete' && !deleted.includes(rel)) throw Error(`删除文件未列入 delete：${rel}`);
      }
      for (const rel of add) {
        if (ws.changes[rel]?.kind !== 'add') throw Error(`add 必须对应实际新增：${rel}`);
        if ((!ROOTS.includes(rel.split('/')[0]) && !FILES.includes(rel)) || REUSE.some(p => rel === p || rel.startsWith(p + '/')) || rel.split('/').some(p => p.startsWith('.')) || /\.(zip|gz|exe|log|tmp)$/i.test(rel)) throw Error(`新增文件超出源码范围：${rel}`);
      }
      for (const rel of deleted) if (ws.changes[rel]?.kind !== 'delete') throw Error(`delete 必须对应实际删除：${rel}`);
      if (!ws.dirty) throw Error('没有待提交改动');
      const commonHashes = {};
      for (const rel of new Set([...Object.keys(old.base), ...Object.keys(old.common || {})])) { const b = readCommon(old, rel); if (b !== null) commonHashes[rel] = hash(b); }
      const delta = changes(commonHashes, files), dir = unique(home, 'revisions');
      snapshot(path.join(old.dir, 'base'), path.join(dir, 'base'), old.base);
      for (const [rel, d] of Object.entries(old.common || {})) if (d.kind !== 'delete') put(safe(path.join(dir, 'common'), rel), readCommon(old, rel));
      for (const [rel, d] of Object.entries(delta)) if (d.kind !== 'delete') put(safe(path.join(dir, 'delta'), rel), fs.readFileSync(safe(path.join(home, 'src'), rel)));
      put(path.join(dir, 'MANIFEST.json'), fs.readFileSync(path.join(old.dir, 'MANIFEST.json')));
      putJson(path.join(dir, 'revision.json'), { ...old, dir: undefined, delta, parent: st.revision, committedChanges: ws.changes });
      const next = path.relative(home, dir).split(path.sep).join('/');
      atomic(path.join(home, 'state.json'), { ...st, revision: next });
      atomic(path.join(home, 'workspace.json'), { revision: next, files });
      atomic(path.join(home, 'src-changes.json'), { add: [], delete: [] });
      return { revision: next, changes: ws.changes, source: 'Hexmods/src，仅导入已登记工作区；未读取原工程' };
    });
  }
  return { checkout, commit, workspaceStatus, assertClean };
};
