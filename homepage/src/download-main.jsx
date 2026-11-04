import React from 'react';
import {hydrateRoot,createRoot} from 'react-dom/client';
import DownloadApp from './respire/download.tsx';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/noto-serif-sc';
import '@fontsource-variable/work-sans';
import './styles.css';

const root=document.getElementById('root');
if(root.hasChildNodes())hydrateRoot(root,<DownloadApp />);
else createRoot(root).render(<DownloadApp />);
