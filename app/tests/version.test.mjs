import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 发版检查单锁定：sw.js 的 VERSION 必须与 app.js 的 UI_BUILD 同步递增，
// 否则主屏 PWA 会拿到新旧混布的资源（见 dev-docs/design/2026-11-04-service-worker-pwa版本更新根治方案.md）。
test('sw.js VERSION 与 app.js UI_BUILD 一致', () => {
  const app = readFileSync('src/app.js', 'utf8');
  const sw = readFileSync('sw.js', 'utf8');
  const ui = app.match(/UI_BUILD='([^']+)'/)?.[1];
  const version = sw.match(/const VERSION='([^']+)'/)?.[1];
  assert.ok(ui, 'app.js 缺少 UI_BUILD 常量');
  assert.ok(version, 'sw.js 缺少 VERSION 常量');
  assert.equal(version, ui, `sw.js VERSION(${version ?? '?'}) 必须与 app.js UI_BUILD(${ui ?? '?'}) 同步递增（发版检查单）`);
});
