const visualizationCsp = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.plot.ly https://unpkg.com",
  "font-src data:",
  "connect-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${visualizationCsp}">`

const trustedVisualizationOrigins = [
  'https://cdn.jsdelivr.net/',
  'https://cdn.plot.ly/',
  'https://unpkg.com/',
]

/** Keep generated pages isolated while allowing supported rendering engines. */
export function safeVisualizationHtml(value: string) {
  return /<head(?:\s[^>]*)?>/i.test(value)
    ? value.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${cspMeta}`)
    : `<!doctype html><html><head>${cspMeta}</head><body>${value}</body></html>`
}

/** Allow the document itself and supported rendering runtimes, but no arbitrary navigation. */
export function isAllowedVisualizationRequest(url: string) {
  return url === 'about:blank'
    || url.startsWith('about:blank#')
    || trustedVisualizationOrigins.some(origin => url.startsWith(origin))
}

/** Render at a useful desktop width and let the WebView scroll on both axes. */
export const visualizationScrollScript = `
  (function () {
    function enableVisualizationScrolling() {
      var root = document.documentElement;
      var body = document.body;
      if (!root || !body) return;
      root.style.overflow = 'auto';
      body.style.overflow = 'auto';
      root.style.webkitOverflowScrolling = 'touch';
      body.style.webkitOverflowScrolling = 'touch';
      root.style.minWidth = '900px';
      body.style.minWidth = '900px';
      body.style.transform = 'none';
      body.style.width = '';
      window.dispatchEvent(new Event('resize'));
    }
    window.addEventListener('load', function () {
      enableVisualizationScrolling();
      window.setTimeout(enableVisualizationScrolling, 120);
      window.setTimeout(enableVisualizationScrolling, 420);
    });
    enableVisualizationScrolling();
    true;
  })();
`
