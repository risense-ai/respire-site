import React from 'react';
import App from '../src/App';
import DownloadApp from '../src/respire/download';

export function renderHome(lang: 'en' | 'zh') {
  return <App initialLang={lang} />;
}

export function renderDownload(lang: 'en' | 'zh') {
  return <DownloadApp initialLang={lang} />;
}
