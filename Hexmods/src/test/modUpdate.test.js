// 网盘更新检查（server/hexmodUpdate.js + shared/modUpdate.js）。
// 关键约束：分享根下并存第一代「盟约」与第二代「规程」，扫描只认自己那一支；网盘失败必须静默降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModUpdateChecker, newestVersionedFile, quarkShareId } from '../server/hexmodUpdate.js';
import {
  canonicalModVersion, compareModVersions, versionFromFileName, parseUpdateManifest, updateCheckView,
  MOD_UPDATE_SCOPE_DEFAULT,
} from '../shared/modUpdate.js';

const res = (body) => ({ ok: true, json: async () => body });

/** 一棵模仿真实分享的树：盟约（第一代）版本号故意更高，规程（第二代）是我们要的。 */
function fakeShare() {
  return async (u) => {
    const s = String(u);
    if (s.includes('/sharepage/token')) return res({ status: 200, data: { stoken: 'st' } });
    if (s.includes('/sharepage/detail')) {
      const fid = new URL(s).searchParams.get('pdir_fid');
      if (fid === '0') {
        return res({ status: 200, data: { list: [
          { fid: '1', file_name: '卫戍协议：盟约 海克斯模组', file_type: 0 },
          { fid: '2', file_name: '卫戍协议：规程 海克斯模组', file_type: 0 },
        ] } });
      }
      if (fid === '1') {
        return res({ status: 200, data: { list: [{ file_name: '卫戍协议：盟约 海克斯模组 v0.9.zip', file_type: 1, size: 111 }] } });
      }
      return res({ status: 200, data: { list: [
        { file_name: '卫戍协议：规程 海克斯模组 v0.1.2.zip', file_type: 1, size: 222 },
        { file_name: '卫戍协议：规程 海克斯模组 v0.1.3.zip', file_type: 1, size: 333 },
      ] } });
    }
    throw new Error(`unexpected url ${s}`);
  };
}

test('版本规范化与比较走三段式（第十个补丁大于第九个）', () => {
  assert.equal(canonicalModVersion('0.1.2'), '0.1.2');
  assert.equal(canonicalModVersion('0.1.2.0'), '0.1.2');
  assert.ok(compareModVersions('0.1.3', '0.1.2') > 0);
  assert.ok(compareModVersions('0.1.10', '0.1.9') > 0);
  assert.equal(compareModVersions('0.1.2', '0.1.2.0'), 0);
  assert.ok(compareModVersions('0.2', '0.1.9') > 0);
  assert.ok(compareModVersions('0.1.2', '0.2') < 0);
});

test('文件名里取最后一个版本号', () => {
  assert.equal(versionFromFileName('卫戍协议：规程 海克斯模组 v0.1.2.zip'), '0.1.2');
  assert.equal(versionFromFileName('v0.1 备份 v0.1.3.zip'), '0.1.3');
  assert.equal(versionFromFileName('没有版本号.zip'), null);
  assert.equal(versionFromFileName(''), null);
});

test('清单校验收窄字段、拒绝坏形状', () => {
  assert.equal(parseUpdateManifest(null), null);
  assert.equal(parseUpdateManifest([]), null);
  assert.equal(parseUpdateManifest({ notes: '缺版本' }), null);
  const m = parseUpdateManifest({ version: '0.1.4', notes: '  修了点东西  ', downloadUrl: 'javascript:alert(1)', file: 'a.zip', bytes: -3 });
  assert.equal(m.version, '0.1.4');
  assert.equal(m.notes, '修了点东西');
  assert.equal(m.downloadUrl, '');
  assert.equal(m.bytes, 0);
});

test('检查视图：无结果不弹窗，有更高版本才 outdated', () => {
  const none = updateCheckView('0.1.2', null);
  assert.equal(none.checked, false);
  assert.equal(none.outdated, false);
  assert.equal(none.latest, '');
  const same = updateCheckView('0.1.2', { version: '0.1.2', notes: 'x', downloadUrl: 'https://a.b/c' });
  assert.equal(same.checked, true);
  assert.equal(same.outdated, false);
  const newer = updateCheckView('0.1.2', { version: '0.1.3', notes: 'x', downloadUrl: 'https://a.b/c', file: 'pkg.zip', bytes: 99 });
  assert.equal(newer.outdated, true);
  assert.equal(newer.latest, '0.1.3');
  assert.equal(newer.file, 'pkg.zip');
  assert.equal(newer.bytes, 99);
});

test('夸克扫描：只认「规程」这一代，第一代的高版本不参与', async () => {
  const checker = createModUpdateChecker({
    url: 'https://pan.quark.cn/s/testshare', current: '0.1.2', fetchImpl: fakeShare(), scope: MOD_UPDATE_SCOPE_DEFAULT,
  });
  const view = await checker.check();
  assert.equal(view.checked, true);
  assert.equal(view.latest, '0.1.3', '规程支的最新版本');
  assert.equal(view.outdated, true);
  assert.equal(view.bytes, 333);
  assert.match(view.file, /规程/);
  assert.ok(!/盟约/.test(view.file), '不能把第一代的包当成规程的更新');
});

test('同一份分享换成「盟约」范围时取第一代的版本', async () => {
  const checker = createModUpdateChecker({
    url: 'https://pan.quark.cn/s/testshare', current: '0.07.2', fetchImpl: fakeShare(), scope: '盟约',
  });
  const view = await checker.check();
  assert.equal(view.latest, '0.9');
  assert.ok(!/规程/.test(view.file));
});

test('网盘失败静默降级为 checked:false（不阻断游戏）', async () => {
  const checker = createModUpdateChecker({
    url: 'https://pan.quark.cn/s/testshare', current: '0.1.2',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const view = await checker.check();
  assert.equal(view.checked, false);
  assert.equal(view.outdated, false);
  assert.equal(view.current, '0.1.2');
});

test('普通 JSON 清单渠道', async () => {
  const checker = createModUpdateChecker({
    url: 'https://example.com/mod.json', current: '0.1.2',
    fetchImpl: async () => res({ version: '0.1.5', notes: '新内容', downloadUrl: 'https://example.com/pkg.zip', bytes: 1234 }),
  });
  const view = await checker.check();
  assert.equal(view.outdated, true);
  assert.equal(view.latest, '0.1.5');
  assert.equal(view.downloadUrl, 'https://example.com/pkg.zip');
  assert.equal(view.bytes, 1234);
});

test('识别夸克分享 id 与列表挑选', () => {
  assert.equal(quarkShareId('https://pan.quark.cn/s/4bd49b5e625f?pwd=abcd'), '4bd49b5e625f');
  assert.equal(quarkShareId('https://example.com/x'), null);
  const best = newestVersionedFile([
    { file_name: '旧版本/规程 v0.1.1.zip', file_type: 1 },
    { file_name: '规程 v0.1.3.zip', file_type: 1, size: 10 },
    { file_name: '目录 v9.9', file_type: 0 },
  ]);
  assert.equal(best.version, '0.1.3');
  assert.equal(best.size, 10);
  assert.equal(newestVersionedFile([{ file_name: '无版本.zip' }]), null);
});
