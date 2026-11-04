import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildProvenance } from "../scripts/build-provenance.mjs";

const ROOT = import.meta.dirname;
const OUT = resolve(ROOT, process.env.VITE_SITE_OUT_DIR || "../site/dist/client");
const BASE = process.env.VITE_SITE_BASE || "/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(BASE)) throw new Error("Invalid website base path");

/// Build the default language at / and other languages at /<locale>/.
///
/// Deployment serves the generated static files by URL.
/// Each language needs an index.html; the client selects strings from the URL.
/// Localized pages differ in language, title, and description.
/// All language entries share the same hashed assets.
///
const LOCALES = ["en", "zh"];

const PAGES = [
  {
    entry: "index.html",
    out: "index.html",
    path: "/",
    head: {
      en: {
        lang: "en",
        title: "Respire — Memory as natural as breathing",
        description:
          "A local-first memory layer for the way you think. Carry useful context across your AI tools and sessions.",
      },
      zh: {
        lang: "zh-CN",
        title: "Respire — 你的记忆，随 AI 同行",
        description:
          "Respire 把你的背景、偏好与项目经验整理成一棵记忆树。本地保存，端到端加密，按所选范围接入你的 AI 工具。",
      },
    },
  },
  {
    entry: "download.html",
    out: "download/index.html",
    path: "download/",
    head: {
      en: {
        lang: "en",
        title: "Download Respire — desktop client for macOS, Windows and Linux",
        description:
          "Detects your system and starts the right download, with manual builds for every supported platform.",
      },
      zh: {
        lang: "zh-CN",
        title: "下载 Respire — macOS、Windows 与 Linux 桌面客户端",
        description: "自动探测系统并开始下载，并提供全部支持平台的手动下载。",
      },
    },
  },
];

/// Localize a generated page's head using its hreflang placeholder.
///
/// Use relative alternate-language links across development and production.
/// Links resolve against the current document origin.
function localize(html, locale, page) {
  const head = page.head[locale];
  const pathSuffix = page.path === "/" ? "" : page.path;
  const alternates = [
    `<link rel="alternate" hreflang="en" href="${BASE}${pathSuffix}" />`,
    `<link rel="alternate" hreflang="zh-Hans" href="${BASE}zh/${pathSuffix}" />`,
    `<link rel="alternate" hreflang="x-default" href="${BASE}${pathSuffix}" />`,
  ].join('\n    ');
  const canonical = `https://rsrs.rs${locale === "en" ? `${page.path === "/" ? "/" : `/${page.path}`}` : `/zh/${pathSuffix}`}`;
  const schema = page.path === "/" ? {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://rsrs.rs/#organization",
        name: "Respire",
        url: "https://rsrs.rs/",
        logo: "https://rsrs.rs/favicon.svg",
        sameAs: ["https://github.com/risense-ai"],
      },
      {
        "@type": "WebSite",
        "@id": "https://rsrs.rs/#website",
        name: "Respire",
        url: "https://rsrs.rs/",
        publisher: { "@id": "https://rsrs.rs/#organization" },
        inLanguage: ["en", "zh-Hans"],
      },
      {
        "@type": "SoftwareApplication",
        name: "Respire",
        url: canonical,
        description: head.description,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Windows, Linux",
        downloadUrl: "https://rsrs.rs/download/",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
        author: { "@id": "https://rsrs.rs/#organization" },
      },
    ],
  } : {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Respire desktop client",
    url: canonical,
    description: head.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Windows, Linux",
    downloadUrl: canonical,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    author: { "@type": "Organization", name: "Respire", url: "https://rsrs.rs/" },
  };
  const discovery = [
    '<meta name="robots" content="index,follow,max-image-preview:large" />',
    '<meta property="og:site_name" content="Respire" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${head.title}" />`,
    `<meta property="og:description" content="${head.description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    '<meta property="og:image" content="https://rsrs.rs/memory-fiber-sculpture.png" />',
    `<meta property="og:locale" content="${locale === "zh" ? "zh_CN" : "en_US"}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${head.title}" />`,
    `<meta name="twitter:description" content="${head.description}" />`,
    '<meta name="twitter:image" content="https://rsrs.rs/memory-fiber-sculpture.png" />',
    `<script type="application/ld+json">${JSON.stringify(schema)}</script>`,
  ].join('\n    ');
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${head.lang}"`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${head.title}</title>`)
    .replace(
      /(<meta name="description" content=")[^"]*(")/,
      `$1${head.description.replace(/"/g, '&quot;')}$2`,
    )
    .replace('<!-- locale:hreflang -->', `<link rel="canonical" href="${canonical}" />\n    ${alternates}\n    ${discovery}`);
}

/// Write the default entry in place and other entries in locale directories.
function multiLocale() {
  return {
    name: "respire-multilocale",
    apply: "build",
    closeBundle() {
      // Pages path redirects must follow the same explicit console destinations
      // as homepage links. Relative local-preview links retain the static defaults.
      const consoleOrigin = (value, fallback) => {
        if (!value || value.startsWith('/')) return fallback;
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
          throw new Error('Homepage console redirects require an HTTPS origin');
        }
        return url.origin;
      };
      const dashboard = consoleOrigin(process.env.VITE_DASHBOARD_URL, 'https://dash.rsrs.rs');
      const admin = consoleOrigin(process.env.VITE_ADMIN_URL, 'https://admin.rsrs.rs');
      writeFileSync(resolve(OUT, '_redirects'), `/dashboard ${dashboard}/dashboard 302\n/dashboard/* ${dashboard}/dashboard/:splat 302\n/admin ${admin}/admin 302\n/admin/* ${admin}/admin/:splat 302\n`);
      writeFileSync(resolve(OUT, "build-info.json"), JSON.stringify({ ...buildProvenance(ROOT), target: "homepage", base: BASE }, null, 2) + "\n");
      for (const page of PAGES) {
        const built = readFileSync(resolve(OUT, page.entry), "utf8");
        mkdirSync(dirname(resolve(OUT, page.out)), { recursive: true });
        writeFileSync(resolve(OUT, page.out), localize(built, "en", page), "utf8");
        for (const locale of LOCALES.filter((l) => l !== "en")) {
          mkdirSync(dirname(resolve(OUT, locale, page.out)), { recursive: true });
          writeFileSync(resolve(OUT, locale, page.out), localize(built, locale, page), "utf8");
        }
      }
      // The rollup-emitted download.html keeps its old URL; the localized
      // download/index.html tree is the only served form.
      rmSync(resolve(OUT, "download.html"), { force: true });
    },
  };
}

export default defineConfig({
  base: BASE,
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(ROOT, "index.html"),
        download: resolve(ROOT, "download.html"),
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  publicDir: "assets",
  plugins: [react(), tailwindcss(), multiLocale()],
});
