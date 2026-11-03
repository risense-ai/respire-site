import {SITE_BASE,CLIENT_REPO_URL,CLIENT_RELEASES_URL,clientAssetUrl,docsUrl} from '../destinations';
import {useState,useEffect} from 'react';
import {Apple,AppWindow,Terminal,Download,Check,Cpu,ShieldCheck} from 'lucide-react';

type Lang='en'|'zh';
type Os='darwin'|'windows'|'linux';
type Arch='amd64'|'arm64';
type Release={tag_name:string;published_at:string;assets:{name:string;size:number}[]};
type UaHints={architecture?:string;bitness?:string};

const RELEASE_API='https://api.github.com/repos/risense-ai/respire-client2/releases/latest';
const ASSETS:{os:Os;arch:Arch;file:string}[]=[
  {os:'darwin',arch:'arm64',file:'respire-darwin-arm64.zip'},
  {os:'darwin',arch:'amd64',file:'respire-darwin-amd64.zip'},
  {os:'windows',arch:'amd64',file:'respire-windows-amd64.exe'},
  {os:'windows',arch:'arm64',file:'respire-windows-arm64.exe'},
  {os:'linux',arch:'amd64',file:'respire-linux-amd64.tar.gz'},
  {os:'linux',arch:'arm64',file:'respire-linux-arm64.tar.gz'},
];
const OS_ICONS={darwin:Apple,windows:AppWindow,linux:Terminal} as const;
const OS_META:{os:Os;name:{en:string;zh:string};requires:{en:string;zh:string};steps:{en:string[];zh:string[]}}[]=[
  {os:'darwin',name:{en:'macOS',zh:'macOS'},requires:{en:'macOS 12 or later',zh:'macOS 12 或更高'},
   steps:{en:['Unzip the archive to get Respire.app and keep it in a permanent folder.','The bundle is ad-hoc signed: on first launch, right-click the app and choose Open.','The app downloads the rsrs runtime on first start, or detects an existing rsrs install.'],
          zh:['解压得到 Respire.app，放到一个固定目录。','应用为 ad-hoc 签名：首次启动请右键点击图标并选择「打开」。','首次启动会下载 rsrs 运行时，也会识别已有的 rsrs 安装。']}},
  {os:'windows',name:{en:'Windows',zh:'Windows'},requires:{en:'Windows 10 or later, Microsoft Edge WebView2',zh:'Windows 10 或更高，需 Microsoft Edge WebView2'},
   steps:{en:['Keep respire-windows-<arch>.exe in a writable, permanent folder and run it directly.','The app downloads the rsrs runtime on first start, or detects an existing rsrs install.'],
          zh:['把 respire-windows-<arch>.exe 放在可写的固定目录，直接运行。','首次启动会下载 rsrs 运行时，也会识别已有的 rsrs 安装。']}},
  {os:'linux',name:{en:'Linux',zh:'Linux'},requires:{en:'GTK 3, WebKitGTK 4.1 and X11 libraries',zh:'GTK 3、WebKitGTK 4.1 与 X11 库'},
   steps:{en:['Extract the tarball and run the single respire executable.','glibc-based distributions are supported (Ubuntu 22.04 baseline).'],
          zh:['解压 tar 包，运行其中的单个 respire 可执行文件。','支持基于 glibc 的发行版（Ubuntu 22.04 基线）。']}},
];

export function detectOS(ua:string):Os|null{
  if(/Windows/i.test(ua))return 'windows';
  if(/Mac OS X|Macintosh/i.test(ua))return 'darwin';
  if(/Linux|X11/i.test(ua)&&!/Android|iPhone|iPad/i.test(ua))return 'linux';
  return null;
}
export async function detectArch():Promise<Arch|null>{
  const uad=(navigator as Navigator&{userAgentData?:{getHighEntropyValues:(hints:string[])=>Promise<UaHints>}}).userAgentData;
  if(!uad?.getHighEntropyValues)return null;
  try{
    const {architecture,bitness}=await uad.getHighEntropyValues(['architecture','bitness']);
    if(bitness==='64'){
      if(architecture==='arm'||architecture==='arm64')return 'arm64';
      if(architecture==='x86'||architecture==='amd64')return 'amd64';
    }
  }catch{}
  return null;
}
function formatSize(bytes:number){return bytes>=1073741824?`${(bytes/1073741824).toFixed(1)} GB`:`${Math.round(bytes/1048576)} MB`;}
function Mark({small=false}:{small?:boolean}){return <svg className={small?'mark small':'mark'} viewBox="0 0 52 44" aria-hidden="true"><path d="M3 23C10 22 9 6 18 7S32 40 41 36c4-2 6-8 8-12" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M3 25C9 14 13 10 19 14s11 24 20 20c5-2 7-6 10-9" fill="none" stroke="#a93021" strokeWidth="1.4"/></svg>}

export default function DownloadApp(){
  const [lang,setLang]=useState<Lang>(()=>new URLSearchParams(window.location.search).get('lang')==='zh'||window.location.pathname.includes('/zh/')?'zh':'en');
  const [mirror,setMirror]=useState(false);
  const [platform,setPlatform]=useState<{os:Os|null;arch:Arch|null}>({os:null,arch:null});
  const [release,setRelease]=useState<Release|null>(null);
  const [autoAsset,setAutoAsset]=useState('');
  const [autoDone,setAutoDone]=useState(false);
  const [countdown,setCountdown]=useState<number|null>(null);
  const [detected,setDetected]=useState(false);
  const t=(a:string,b:string)=>lang==='en'?a:b;
  const triggerDownload=(file:string)=>{const a=document.createElement('a');a.href=clientAssetUrl(file,mirror);a.rel='noopener';document.body.appendChild(a);a.click();a.remove();};
  useEffect(()=>{document.documentElement.lang=lang==='zh'?'zh-CN':'en';},[lang]);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      // Tests and shared links can pin the detected platform: ?os=linux&arch=amd64
      // or arch=none to exercise the unknown-architecture fallback.
      const params=new URLSearchParams(window.location.search);
      const osParam=params.get('os');
      const archParam=params.get('arch');
      const os=osParam==='windows'||osParam==='darwin'||osParam==='linux'?osParam:detectOS(window.navigator.userAgent);
      const arch=archParam==='amd64'||archParam==='arm64'?archParam:archParam==='none'?null:await detectArch();
      if(cancelled)return;
      setPlatform({os,arch});
      setDetected(true);
      const asset=os&&arch?ASSETS.find(a=>a.os===os&&a.arch===arch):undefined;
      if(asset&&!navigator.webdriver){setAutoAsset(asset.file);setCountdown(3);}
    })();
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    if(countdown===null)return;
    if(countdown<=0){triggerDownload(autoAsset);setAutoDone(true);setAutoAsset('');setCountdown(null);return;}
    const timer=setTimeout(()=>setCountdown(countdown-1),1000);
    return()=>clearTimeout(timer);
  },[countdown,autoAsset,mirror]);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    fetch(RELEASE_API,{signal:controller.signal,headers:{Accept:'application/vnd.github+json'}})
      .then(r=>r.ok?r.json():null)
      .then((data:Release|null)=>{if(data?.tag_name)setRelease(data);})
      .catch(()=>{});
    return()=>{clearTimeout(timer);controller.abort();};
  },[]);
  const changeLang=(next:Lang)=>{
    setLang(next);
    if(window.location.pathname.endsWith('.html')){const url=new URL(window.location.href);if(next==='zh')url.searchParams.set('lang','zh');else url.searchParams.delete('lang');window.history.replaceState(null,'',url);}
    else window.location.assign(next==='zh'?`${SITE_BASE}zh/download/`:`${SITE_BASE}download/`);
  };
  const cancelAuto=()=>{setAutoAsset('');setCountdown(null);};
  const recommended=platform.os&&platform.arch?ASSETS.find(a=>a.os===platform.os&&a.arch===platform.arch):undefined;
  const sizes=new Map((release?.assets??[]).map(a=>[a.name,a.size] as [string,number]));
  const archHint=platform.os&&!platform.arch?(platform.os==='darwin'
    ?{en:'We couldn\'t detect your chip. Macs from 2020 onward use Apple silicon; earlier Macs use Intel. Pick a build below.',zh:'未能识别你的芯片。2020 年之后的 Mac 使用 Apple 芯片，更早的机型使用 Intel。请在下方选择。'}
    :{en:'We couldn\'t detect your architecture. Most machines use 64-bit (x86_64). Pick a build below.',zh:'未能识别处理器架构。多数设备为 64 位（x86_64）。请在下方选择。'}):null;
  return <div className={'download-page '+(lang==='zh'?'zh':'')}>
    <a href="#main" className="skip-link">{lang==='en'?'Skip to content':'跳转到内容'}</a>
    <header className="site-header download-header">
      <a className="logo" href={SITE_BASE} aria-label="Respire home"><Mark/><span>respire<span className="logo-period">.</span></span></a>
      <div className="header-actions">
        <div className="language" aria-label={lang==='en'?'Language':'语言'}><button aria-pressed={lang==='en'} onClick={()=>changeLang('en')}>EN</button><span>/</span><button aria-pressed={lang==='zh'} onClick={()=>changeLang('zh')}>中文</button></div>
        <a className="header-login" href={SITE_BASE}>{t('Back to rsrs.rs','返回首页')}</a>
        <a className="button small dark" href={docsUrl(lang,'/')} target="_blank" rel="noopener noreferrer">{t('Docs','文档')}</a>
      </div>
    </header>
    <main className="download-main" id="main">
      <section className="download-hero">
        <div className="section-kicker"><span>{t('DESKTOP CLIENT','桌面客户端')}</span><span>{release?.tag_name??'respire-client2'}</span></div>
        <h1>{t('Download Respire','下载 Respire')}<br/><em>{t('for your desktop.','装进你的桌面。')}</em></h1>
        <p className="download-lede">{t('One desktop app for macOS, Windows and Linux. It keeps your memory local, downloads the rsrs runtime on first start, and needs no Node.js, Go, npm or Rust.','一个桌面应用，覆盖 macOS、Windows 与 Linux。记忆保存在本地，首次启动自动下载 rsrs 运行时，无需安装 Node.js、Go、npm 或 Rust。')}</p>
        {recommended?<div className="download-recommend" data-download-recommend data-recommended-asset={recommended.file}>
          <div className="download-recommend-info">
            <span className="micro">{t('DETECTED SYSTEM','检测到的系统')}</span>
            <strong className="download-file">{recommended.file}{(assetSize=>assetSize!==undefined?` · ${formatSize(assetSize)}`:'')(sizes.get(recommended.file))}</strong>
            {autoAsset&&countdown!==null&&<span className="auto-chip"><Cpu size={14}/><span data-auto-countdown>{t(`Your download starts in ${countdown} s`,`${countdown} 秒后自动开始下载`)}</span><button className="text-action" onClick={cancelAuto}>{t('Cancel','取消')}</button></span>}
            {autoDone&&<span className="auto-chip" data-auto-started><Check size={14}/>{t('Download started. If nothing happened, use the button.','下载已开始。若没有反应，请使用下载按钮。')}</span>}
          </div>
          <a className="button dark" href={clientAssetUrl(recommended.file,mirror)} data-download-link data-asset={recommended.file}><Download size={16}/>{t('Download now','立即下载')}</a>
        </div>:null}
        {archHint&&<div className="download-arch-hint" data-arch-hint><Cpu size={15}/>{t(archHint.en,archHint.zh)}</div>}
        {detected&&platform.os===null&&<div className="download-arch-hint" data-os-hint><Cpu size={15}/>{t('We couldn\'t detect your system — pick a platform below.','未能识别你的系统——请在下方选择平台。')}</div>}
      </section>
      <section aria-label={t('All downloads','全部下载')} className="download-grid-wrap">
        <div className="download-grid" data-download-grid>
          {OS_META.map(meta=>{const Icon=OS_ICONS[meta.os];const groupMatch=platform.os===meta.os;
            return <div className="download-group" key={meta.os} data-os={meta.os} data-recommended-group={groupMatch?'':undefined}>
              <div className="download-group-head"><Icon size={22}/><div><h2>{t(meta.name.en,meta.name.zh)}</h2><span className="download-group-requirement">{t(meta.requires.en,meta.requires.zh)}</span></div>{groupMatch&&<span className="download-badge">{t('YOUR SYSTEM','你的系统')}</span>}</div>
              {ASSETS.filter(a=>a.os===meta.os).map(a=>{const size=sizes.get(a.file);const isRecommended=groupMatch&&platform.arch===a.arch;const isSuggested=groupMatch&&platform.arch===null;
                return <a key={a.file} className="download-card" href={clientAssetUrl(a.file,mirror)} data-download-link data-asset={a.file} data-recommended={isRecommended?'':undefined} data-suggested={isSuggested?'':undefined}>
                  <span className="micro">{t(a.arch==='amd64'?'64-bit (x86_64)':'ARM64',a.arch==='amd64'?'64 位（x86_64）':'ARM64')}</span>
                  <strong>{a.file}</strong>
                  {size!==undefined&&<span className="download-size">{formatSize(size)}</span>}
                  {isRecommended&&<span className="download-badge">{t('RECOMMENDED','推荐版本')}</span>}
                </a>;})}
            </div>;})}
        </div>
      </section>
      <section className="download-notes">
        <div>
          <h2>{t('After the download','下载之后')}</h2>
          <p className="download-notes-lede">{t('No installer, no dependencies. Everything the client stores lives under ~/.rsrs on your device.','无需安装器，无需额外依赖。客户端的所有数据都保存在设备的 ~/.rsrs 下。')}</p>
          <div className="download-steps" data-install-notes>
            {OS_META.map(meta=>{const Icon=OS_ICONS[meta.os];return <article key={meta.os} data-install-platform={meta.os} data-recommended-group={platform.os===meta.os?'':undefined}>
              <h3><Icon size={18}/>{t(meta.name.en,meta.name.zh)}</h3>
              <ol>{meta.steps[lang].map(step=><li key={step}>{step}</li>)}</ol>
              <span className="download-group-requirement">{t(meta.requires.en,meta.requires.zh)}</span>
            </article>;})}
          </div>
        </div>
        <aside className="download-aside">
          <h2>{t('Verify and browse','校验与更多版本')}</h2>
          <div className="download-links">
            <a href={clientAssetUrl('SHA256SUMS',mirror)} data-download-link data-asset="SHA256SUMS"><ShieldCheck size={15}/>{t('SHA256 checksums (SHA256SUMS)','SHA256 校验和（SHA256SUMS）')}</a>
            <a href={CLIENT_RELEASES_URL} target="_blank" rel="noopener noreferrer"><Download size={15}/>{t('All releases and Dev pre-releases','全部版本与 Dev 预发布')}</a>
            <a href={docsUrl(lang,'/')} target="_blank" rel="noopener noreferrer"><Terminal size={15}/>{t('Documentation','文档')}</a>
          </div>
          <label className="download-mirror">
            <input type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)} data-mirror-toggle/>
            <span>{t('Mainland China mirror (gh-proxy.com)','中国大陆镜像（gh-proxy.com）')}</span>
          </label>
          <p className="download-legal">{t('macOS builds carry an ad-hoc signature (not notarized) and Windows builds are unsigned; binaries are built by CI from the public repository.','macOS 版本为 ad-hoc 签名（未经公证），Windows 版本未做代码签名；安装包由 CI 从公开仓库构建。')}</p>
        </aside>
      </section>
    </main>
    <footer className="site-footer download-footer"><Mark small/><span>{t('Local first. Yours to keep.','本地优先，始终属于你。')}</span><div><a href={CLIENT_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub · respire-client2</a><a href={docsUrl(lang,'/')} target="_blank" rel="noopener noreferrer">{t('Documentation','文档')}</a><span>© 2026 Respire</span></div></footer>
  </div>;
}
