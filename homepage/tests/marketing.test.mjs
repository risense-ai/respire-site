import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
test('marketing routes use production portals, not prototype account screens',()=>{
  const app=read('../src/App.tsx');
  const destinations=read('../src/destinations.ts');
  assert.ok(destinations.includes('https://dash.rsrs.rs'));
  assert.ok(destinations.includes('https://admin.rsrs.rs'));
  assert.ok(app.includes('href={DASHBOARD_URL}'));
  assert.doesNotMatch(app,/href="\/(?:dashboard|admin)/);
  assert.doesNotMatch(app,/DESIGN PREVIEW|No live services|useDemoState/);
});
test('installation and product guidance describe the supported CLI',()=>{
  const details=read('../src/respire/product-details.tsx');
  assert.ok(details.includes('npm i -g rsrs-cli'));
  assert.ok(details.includes('pnpm add -g rsrs-cli'));
  assert.ok(details.includes('rsrs doctor'));
  assert.doesNotMatch(details,/proprietary|open source|product brief|hospital deployment/i);
});
test('homepage lists every supported plugin with a matching docs guide',()=>{
  const plugins=read('../src/respire/plugins.tsx');
  const destinations=read('../src/destinations.ts');
  const expected=[['zcode','/plugins/zcode'],['kimi','/plugins/kimi'],['dim','/plugins/dimcode'],['qoder','/plugins/qoder'],['workbuddy','/plugins/workbuddy'],['hermes','/plugins/hermes'],['codex','/plugins/codex'],['pi','/plugins/pi']];
  assert.ok(destinations.includes('https://docs.rsrs.rs'));
  assert.ok(destinations.includes('docsUrl'));
  for(const [id,path] of expected){
    assert.ok(plugins.includes(`id:'${id}'`),`missing plugin ${id}`);
    assert.ok(plugins.includes(`path:'${path}'`),`missing docs path ${path}`);
  }
});
test('production output copies the current website assets',()=>{
  assert.ok(read('../vite.config.mjs').includes('publicDir: "assets"'));
});

test('public build metadata is generated from the checkout, not a hard-coded revision',()=>{
  const config=read('../vite.config.mjs');
  assert.ok(config.includes('buildProvenance(ROOT)'));
  assert.ok(config.includes('"build-info.json"'));
  assert.ok(config.includes('target: "homepage"'));
});
test('download page exposes every client platform build',()=>{
  const destinations=read('../src/destinations.ts');
  const download=read('../src/respire/download.tsx');
  const headers=read('../assets/_headers');
  assert.ok(destinations.includes('https://github.com/risense-ai/respire-client2'));
  assert.ok(destinations.includes('releases/latest/download'));
  assert.ok(destinations.includes('clientAssetUrl'));
  assert.ok(destinations.includes('downloadUrl'));
  assert.ok(download.includes('https://api.github.com/repos/risense-ai/respire-client2/releases/latest'));
  assert.ok(download.includes('gh-proxy.com'));
  for(const file of ['respire-darwin-arm64.zip','respire-darwin-amd64.zip','respire-windows-amd64.exe','respire-windows-arm64.exe','respire-linux-amd64.tar.gz','respire-linux-arm64.tar.gz']){
    assert.ok(download.includes(`'${file}'`),`missing download asset ${file}`);
  }
  assert.ok(headers.includes('/download/'));
  assert.ok(headers.includes('/zh/download/'));
});
test('homepage and install section link the download page',()=>{
  const app=read('../src/App.tsx');
  const details=read('../src/respire/product-details.tsx');
  assert.ok(app.includes('href={downloadUrl(lang)}'));
  assert.ok(details.includes('href={downloadUrl(lang)}'));
});
test('build emits localized download pages beside the homepage',()=>{
  const config=read('../vite.config.mjs');
  assert.ok(config.includes('download: resolve(ROOT, "download.html")'));
  assert.ok(config.includes('"download/index.html"'));
});
