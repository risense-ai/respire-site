import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright';
import {buildProvenance} from '../../scripts/build-provenance.mjs';

const dist=resolve(process.env.VITE_SITE_OUT_DIR || '../site/dist/client');
const base=process.env.VITE_SITE_BASE || '/';
const screenshots=process.env.SITE_SCREENSHOTS;
const metadata=JSON.parse(readFileSync(resolve(dist,'build-info.json'),'utf8'));
assert.equal(metadata.site_revision,buildProvenance(process.cwd()).site_revision);
assert.equal(metadata.target,'homepage');
assert.equal(metadata.base,base);
if(process.env.CI)assert.equal(metadata.source_tree_dirty,false,'CI homepage artifacts must come from clean source');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.xml':'application/xml','.txt':'text/plain'};
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith(base)){res.writeHead(404).end();return;}
  let name=decodeURIComponent(url.pathname.slice(base.length));
  if(!name || name.endsWith('/'))name+='index.html';
  const file=resolve(dist,name);
  if(!file.startsWith(dist+sep) || !existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream'}).end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const provenance=await context.request.get(origin+base+'build-info.json');
  assert.equal(provenance.status(),200);
  assert.deepEqual(await provenance.json(),metadata);
  for(const file of ['robots.txt','llms.txt','sitemap.xml']){
    const response=await context.request.get(origin+base+file);
    assert.equal(response.status(),200);
    assert.match(response.headers()['content-type'],file.endsWith('.xml')?/application\/xml/:/text\/plain/);
    assert.doesNotMatch(await response.text(),/<!DOCTYPE html>/i,`${file} must not use the SPA fallback`);
  }
  for(const [path,lang,heading] of [['','en','Memory as'],['zh/','zh-CN','记忆'],['download/','en','Download Respire'],['zh/download/','zh-CN','下载 Respire']]){
    const raw=await (await context.request.get(origin+base+path)).text();
    assert.match(raw,/<h1[^>]*>/,`${path} needs a pre-rendered H1`);
    assert.ok(raw.includes(heading),`${path} needs pre-rendered localized content`);
    assert.ok(raw.includes(`lang="${lang}"`));
    assert.ok(raw.includes(`href="https://rsrs.rs/${path}"`),`${path} needs a self-referencing canonical`);
    assert.ok(raw.includes('hreflang="en"')&&raw.includes('hreflang="zh-Hans"')&&raw.includes('hreflang="x-default"'));
    assert.ok(raw.includes('application/ld+json'));
    assert.ok(raw.includes('og:image'));
    assert.ok((raw.match(/<a /g)||[]).length>=10,`${path} needs crawlable links`);
    assert.ok(raw.indexOf('<meta charset="UTF-8"')<1024);
  }
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+base);
  await page.getByRole('heading',{level:1}).waitFor();
  assert.match(await page.locator('h1').innerText(),/Memory as/);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.getByRole('link',{name:'Sign in',exact:true}).getAttribute('href'),process.env.VITE_DASHBOARD_URL || 'https://dash.rsrs.rs');
  assert.ok((await page.locator('body').innerText()).includes('npm i -g rsrs-cli'));
  assert.doesNotMatch(await page.locator('body').innerText(),/DESIGN PREVIEW|No live services|proprietary components/);
  const docsOrigin=(process.env.VITE_DOCS_URL||'https://docs.rsrs.rs').replace(/\/+$/,'');
  const pluginPaths=['/plugins/zcode','/plugins/kimi','/plugins/dimcode','/plugins/qoder','/plugins/workbuddy','/plugins/hermes','/plugins/codex','/plugins/pi'];
  const pluginCards=page.locator('[data-plugin-card]');
  assert.equal(await pluginCards.count(),pluginPaths.length);
  assert.deepEqual(await pluginCards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),pluginPaths.map(path=>docsOrigin+path));
  assert.equal(await page.getByRole('link',{name:'Download',exact:true}).getAttribute('href'),base+'download/');
  await page.locator('[data-memory-body]').waitFor();
  await page.waitForFunction(()=>['ready','fallback','unavailable','setup-error'].includes(document.querySelector('[data-gpu-status]')?.dataset.gpuStatus));
  const gpuStatus=await page.locator('[data-gpu-status]').getAttribute('data-gpu-status');
  assert.notEqual(gpuStatus,'setup-error');
  const sculpture=page.getByRole('group',{name:/Slowly breathing memory fibers/});
  await sculpture.focus();await sculpture.press('p');
  assert.equal(await page.locator('[data-memory-body]').getAttribute('data-paused'),'true');
  await sculpture.press('p');
  assert.equal(await page.locator('[data-memory-body]').getAttribute('data-paused'),'false');
  if(screenshots){mkdirSync(screenshots,{recursive:true});await page.screenshot({path:resolve(screenshots,'desktop.png'),fullPage:true});}
  await page.getByRole('button',{name:'How do I get started?',exact:true}).click();
  assert.ok(await page.getByText('Install rsrs-cli with npm, run rsrs doctor,',{exact:false}).isVisible());
  await page.getByRole('button',{name:'中文',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,base+'zh/');
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
  assert.equal(await page.locator('[data-plugin="zcode"]').getAttribute('href'),docsOrigin+'/zh/plugins/zcode');
  await page.reload();
  assert.match(await page.locator('h1').innerText(),/记忆/);
  assert.equal(await page.getByRole('link',{name:'下载',exact:true}).getAttribute('href'),base+'zh/download/');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  const menu=page.getByRole('button',{name:'切换导航',exact:true});
  await menu.click();assert.equal(await menu.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');
  if(screenshots)await page.screenshot({path:resolve(screenshots,'mobile-zh.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
  await page.locator('[data-memory-body] [data-gpu-status="ready"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('.memory-narrative')?.dataset.threadProgress==='1.000');
  // Desktop client download page. ?os=&arch= pins detection so the checks
  // are independent of the machine running them.
  const dlAssets=['respire-darwin-arm64.zip','respire-darwin-amd64.zip','respire-windows-amd64.exe','respire-windows-arm64.exe','respire-linux-amd64.tar.gz','respire-linux-arm64.tar.gz'];
  const assetOrigin='https://github.com/risense-ai/respire-client2/releases/latest/download/';
  const dl=await context.newPage();
  dl.on('pageerror',e=>errors.push(e.message));
  await dl.goto(origin+base+'download/');
  await dl.getByRole('heading',{level:1}).waitFor();
  assert.match(await dl.locator('h1').innerText(),/Download Respire/);
  assert.equal(await dl.locator('html').getAttribute('lang'),'en');
  assert.equal(await dl.locator('[data-download-grid] .download-group').count(),3);
  for(const asset of dlAssets)assert.equal(await dl.locator(`[data-download-grid] [data-download-link][data-asset="${asset}"]`).getAttribute('href'),assetOrigin+asset);
  assert.equal(await dl.locator('[data-auto-countdown]').count(),0,'automated browsers must not trigger the countdown download');
  await dl.goto(origin+base+'download/?os=linux&arch=amd64');
  await dl.getByRole('heading',{level:1}).waitFor();
  assert.equal(await dl.locator('[data-download-recommend]').getAttribute('data-recommended-asset'),'respire-linux-amd64.tar.gz');
  assert.equal(await dl.locator('[data-os="linux"]').getAttribute('data-recommended-group'),'');
  assert.equal(await dl.locator('[data-download-grid] [data-download-link][data-asset="respire-linux-amd64.tar.gz"][data-recommended]').count(),1);
  await dl.goto(origin+base+'download/?os=windows&arch=arm64');
  await dl.getByRole('heading',{level:1}).waitFor();
  assert.equal(await dl.locator('[data-download-recommend]').getAttribute('data-recommended-asset'),'respire-windows-arm64.exe');
  await dl.goto(origin+base+'download/?os=darwin&arch=none');
  await dl.getByRole('heading',{level:1}).waitFor();
  assert.equal(await dl.locator('[data-download-recommend]').count(),0,'unknown architecture must not auto-pick a build');
  assert.equal(await dl.locator('[data-arch-hint]').count(),1);
  assert.equal(await dl.locator('[data-os="darwin"]').getAttribute('data-recommended-group'),'');
  assert.equal(await dl.locator('[data-download-grid] .download-card[data-suggested]').count(),2);
  await dl.locator('[data-mirror-toggle]').click();
  assert.equal(await dl.locator('[data-download-grid] [data-download-link][data-asset="respire-darwin-arm64.zip"]').getAttribute('href'),'https://gh-proxy.com/'+assetOrigin+'respire-darwin-arm64.zip');
  await dl.locator('[data-mirror-toggle]').click();
  assert.equal(await dl.locator('[data-download-grid] [data-download-link][data-asset="respire-darwin-arm64.zip"]').getAttribute('href'),assetOrigin+'respire-darwin-arm64.zip');
  await dl.goto(origin+base+'zh/download/?os=linux&arch=amd64');
  await dl.getByRole('heading',{level:1}).waitFor();
  assert.equal(await dl.locator('html').getAttribute('lang'),'zh-CN');
  assert.match(await dl.locator('h1').innerText(),/下载 Respire/);
  assert.equal(await dl.locator('[data-download-recommend]').getAttribute('data-recommended-asset'),'respire-linux-amd64.tar.gz');
  assert.equal(await dl.getByRole('link',{name:'返回首页',exact:true}).getAttribute('href'),base);
  await dl.setViewportSize({width:390,height:844});
  assert.ok(await dl.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,base,gpu_status:gpuStatus,checks:['exact public build provenance','English rendering','production links','installation','plugin guides','download nav link','no demo notices','animation pause/resume','FAQ','Chinese URL and reload','mobile overflow/menu','reduced motion','download page en/zh rendering','download platform detection','download asset links and mirror toggle','no page errors']}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
