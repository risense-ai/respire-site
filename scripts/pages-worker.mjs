// consoleHosts is generated from the same public origins as homepage links.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = consoleHosts[url.hostname];
    if (!target) {
      const response = await env.ASSETS.fetch(request);
      const isHtml = response.status === 200 && response.headers.get('content-type')?.includes('text/html');
      if (url.pathname === '/404.html') {
        return new Response(response.body, { status: 404, headers: response.headers });
      }
      const knownPage = ['/', '/zh/', '/download/', '/zh/download/', '/index.html', '/zh/index.html', '/download/index.html', '/zh/download/index.html'].includes(url.pathname);
      if (!isHtml || knownPage) return response;
      const notFoundUrl = new URL('/404.html', url);
      const notFound = await env.ASSETS.fetch(new Request(notFoundUrl, request));
      return new Response(notFound.body, { status: 404, headers: notFound.headers });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Frontend requests must use the configured API origin', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/build-info.json') {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ...consoleBuild, target }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' },
      });
    }
    const prefix = '/__console';
    if (url.pathname === '/source-notice.json' || url.pathname.startsWith('/licenses/') || /^\/[A-Za-z0-9_-]+\.woff2$/.test(url.pathname)) {
      url.pathname = prefix + url.pathname;
    } else {
      // Request the pretty asset path to avoid Pages' index.html canonical redirect.
      url.pathname = prefix + '/';
    }
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    return response;
  },
};
