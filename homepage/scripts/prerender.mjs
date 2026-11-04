import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, process.env.VITE_SITE_OUT_DIR || '../site/dist/client');
const vite = await createServer({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'error',
  base: process.env.VITE_SITE_BASE || '/',
  server: { middlewareMode: true, ws: false, watch: null },
  appType: 'custom',
  resolve: { dedupe: ['react', 'react-dom'] },
});

try {
  const { default: App } = await vite.ssrLoadModule(resolve(root, 'src/App.tsx'));
  const { default: DownloadApp } = await vite.ssrLoadModule(resolve(root, 'src/respire/download.tsx'));
  for (const [path, Component] of [['index.html', App], ['download/index.html', DownloadApp]]) {
    for (const lang of ['en', 'zh']) {
      const output = resolve(dist, lang === 'zh' ? `zh/${path}` : path);
      const html = readFileSync(output, 'utf8');
      const content = renderToString(createElement(Component, { initialLang: lang }));
      const marker = '<div id="root"></div>';
      if (!html.includes(marker)) throw new Error(`Missing prerender root: ${output}`);
      writeFileSync(output, html.replace(marker, `<div id="root">${content}</div>`));
    }
  }
} finally {
  await vite.close();
}
