import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { exportLiveCanvasZip, getLivePreviewRevision, prepareFittedHtmlPreview, readHtmlPreview } from '../lib/ipc'
import { useT } from '../i18n'

type IntrinsicSize = { width: number; height: number }
type FrameMode = 'inline' | 'panel'

export function isCanvasFrameSource(
  source: MessageEventSource | null,
  current: Window | null | undefined,
  previous: Window | null | undefined,
) {
  return Boolean(source && (source === current || source === previous))
}

export function calculateFittedFrameLayout(
  intrinsic: IntrinsicSize | null,
  containerSize: IntrinsicSize,
  mode: FrameMode,
) {
  const targetHeight = mode === 'inline'
    ? Math.min(680, Math.max(420, Math.round(containerSize.width * 0.68)))
    : Math.max(1, containerSize.height)
  const hasUsableViewport = containerSize.width >= 24 && containerSize.height >= 24
  const widthScale = intrinsic && hasUsableViewport
    ? Math.min(1, containerSize.width / intrinsic.width)
    : 1
  // In a conversation, moderately tall visuals should fit as a whole instead
  // of creating a second scroll area. Never shrink a dense page below a
  // readable threshold: truly long documents retain vertical scrolling.
  const heightScale = intrinsic && hasUsableViewport
    ? Math.min(1, targetHeight / intrinsic.height)
    : 1
  const conversationFitScale = Math.min(widthScale, heightScale)
  const scale = mode === 'inline' && conversationFitScale >= 0.68
    ? conversationFitScale
    : widthScale
  const scaledHeight = intrinsic ? Math.max(1, Math.ceil(intrinsic.height * scale)) : targetHeight
  const shouldScroll = Boolean(intrinsic && hasUsableViewport && scaledHeight > targetHeight + 1)

  return {
    targetHeight,
    hasUsableViewport,
    scale,
    shouldScroll,
    frameHeight: shouldScroll ? targetHeight : scaledHeight,
  }
}

const sizeReporter = `<script>
  (function () {
    var root = document.documentElement;
    var body = document.body;
    var inspectorStyle = document.createElement('style');
    inspectorStyle.textContent = 'html[data-bob-inspect="true"],html[data-bob-inspect="true"] *{cursor:crosshair!important}';
    document.head.appendChild(inspectorStyle);
    function intrinsicSize() {
      var previous = {
        transform: body.style.transform,
        width: body.style.width,
        bodyOverflow: body.style.overflow,
        rootOverflow: root.style.overflow,
        rootOverflowX: root.style.overflowX,
        rootOverflowY: root.style.overflowY
      };
      body.style.transform = ''; body.style.width = ''; body.style.overflow = 'hidden';
      root.style.overflow = 'hidden';
      var size = { width: Math.max(root.scrollWidth, body.scrollWidth, 1), height: Math.max(root.scrollHeight, body.scrollHeight, 1) };
      body.style.transform = previous.transform;
      body.style.width = previous.width;
      body.style.overflow = previous.bodyOverflow;
      root.style.overflow = previous.rootOverflow;
      root.style.overflowX = previous.rootOverflowX;
      root.style.overflowY = previous.rootOverflowY;
      return size;
    }
    var lastReported = '';
    function report() {
      var size = intrinsicSize();
      var key = size.width + 'x' + size.height;
      if (key === lastReported) return;
      lastReported = key;
      window.parent.postMessage(JSON.stringify({ type: 'bob-visual-size', width: size.width, height: size.height }), '*');
    }
    window.addEventListener('load', function () {
      setTimeout(report, 80);
      setTimeout(report, 320);
      setTimeout(report, 900);
      if (window.ResizeObserver) new ResizeObserver(report).observe(body);
    });
    window.addEventListener('message', function (event) {
      if (typeof event.data !== 'string') return;
      try {
        var message = JSON.parse(event.data);
        if (message.type === 'bob-visual-fit' && typeof message.scale === 'number') {
          body.style.transformOrigin = 'top left'; body.style.transform = 'scale(' + message.scale + ')';
          body.style.width = (100 / message.scale) + '%'; body.style.overflow = message.scroll ? 'visible' : 'hidden';
          root.style.overflowX = 'hidden'; root.style.overflowY = message.scroll ? 'auto' : 'hidden';
        }
        if (message.type === 'bob-dom-inspector') {
          root.dataset.bobInspect = message.enabled ? 'true' : 'false';
          if (!message.enabled && highlighted) {
            highlighted.style.outline = highlighted.dataset.bobPreviousOutline || '';
            highlighted = null;
          }
        }
      } catch (_) {}
    });
    var highlighted = null;
    document.addEventListener('mouseover', function (event) {
      if (root.dataset.bobInspect !== 'true') return;
      if (highlighted) highlighted.style.outline = highlighted.dataset.bobPreviousOutline || '';
      highlighted = event.target; highlighted.dataset.bobPreviousOutline = highlighted.style.outline || '';
      highlighted.style.outline = '2px solid #0f62fe'; event.stopPropagation();
    }, true);
    document.addEventListener('click', function (event) {
      if (root.dataset.bobInspect !== 'true') return;
      event.preventDefault(); event.stopPropagation(); var element = event.target; var rect = element.getBoundingClientRect();
      window.parent.postMessage(JSON.stringify({ type:'bob-dom-selection', tag:element.tagName.toLowerCase(), id:element.id || '', classes:element.className && typeof element.className === 'string' ? element.className : '', text:(element.textContent || '').trim().slice(0,240), rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height} }), '*');
    }, true);
  })();
</script>`

const threeCdnScript = /<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"']*["'][^>]*><\/script>\s*/gi
const echartsCdnScript = /<script\b[^>]*\bsrc=["']https:\/\/cdn\.jsdelivr\.net\/npm\/echarts@[^"']*["'][^>]*><\/script>\s*/gi
const threeRuntimeUrl = new URL('/runtime/three-embed-bridge.js', window.location.href).href

export function withLocalThreeRuntime(value: string, localThreeRuntime: string | null): string {
  if (!/https:\/\/cdn\.jsdelivr\.net\/npm\/(?:three|echarts)@/i.test(value)) return value
  if (!localThreeRuntime) return value
  const withoutCdn = value.replace(threeCdnScript, '').replace(echartsCdnScript, '')
  // The sandbox inherits the host CSP and consequently cannot fetch a script
  // URL, even one served by the local Tauri origin.  An inline bridge is safe
  // here: it is produced at build time from Bob Work's packaged dependency.
  const bridge = `<script>${localThreeRuntime}</script>`
  if (/<head(?:\s[^>]*)?>/i.test(withoutCdn)) {
    return withoutCdn.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${bridge}`)
  }
  return `<!doctype html><html><head>${bridge}</head><body>${withoutCdn}</body></html>`
}

function fittedDocument(value: string, sourcePath: string, localThreeRuntime: string | null) {
  // The controlled measurement script is parsed before the artifact's own CSP.
  // The artifact CSP still governs all of its original code and network policy.
  const baseUrl = (() => {
    try { return convertFileSrc(sourcePath) } catch { return sourcePath }
  })()
  const base = `<base href="${baseUrl.replace(/"/g, '&quot;')}">`
  const documentWithLocalRuntime = withLocalThreeRuntime(value, localThreeRuntime)
  if (/<head(?:\s[^>]*)?>/i.test(documentWithLocalRuntime)) {
    return documentWithLocalRuntime.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${base}${sizeReporter}`)
  }
  return `<!doctype html><html><head>${base}${sizeReporter}</head><body>${documentWithLocalRuntime}</body></html>`
}

async function canvasDocument(value: string, sourcePath: string) {
  const extension = sourcePath.split('.').pop()?.toLowerCase()
  if (extension === 'svg') return `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff}body{display:grid;place-items:center}svg{max-width:100%;height:auto}</style></head><body>${value}</body></html>`
  if (extension === 'mmd' || extension === 'mermaid') {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    const rendered = await mermaid.render(`bob-live-mermaid-${Date.now()}`, value)
    return `<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:#fff}body{display:grid;place-items:center;padding:20px;box-sizing:border-box}svg{max-width:100%;height:auto}</style></head><body>${rendered.svg}</body></html>`
  }
  return value
}

export function FittedHtmlFrame({ src, title, mode }: { src: string; title: string; mode: FrameMode }) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const previousFrameRef = useRef<HTMLIFrameElement>(null)
  const [frameSource, setFrameSource] = useState<string | null>(null)
  const [previousFrameSource, setPreviousFrameSource] = useState<string | null>(null)
  const frameSourceRef = useRef<string | null>(null)
  const revisionRef = useRef('')
  const [reloadToken, setReloadToken] = useState(0)
  const [live, setLive] = useState(true)
  const [inspector, setInspector] = useState(false)
  const [comparison, setComparison] = useState(false)
  const [selection, setSelection] = useState('')
  const [exporting, setExporting] = useState(false)
  const [localThreeRuntime, setLocalThreeRuntime] = useState<string | null>(null)
  const [intrinsic, setIntrinsic] = useState<IntrinsicSize | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 1, height: mode === 'inline' ? 380 : 1 })

  useEffect(() => {
    revisionRef.current = ''
  }, [src])

  useEffect(() => {
    let disposed = false
    void fetch(threeRuntimeUrl)
      .then(response => response.ok ? response.text() : null)
      .then(source => { if (!disposed) setLocalThreeRuntime(source) })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    setFrameSource(null)
    setIntrinsic(null)
    readHtmlPreview(src)
      .then(value => canvasDocument(value, src))
      .then(value => fittedDocument(value, src, localThreeRuntime))
      .then(value => prepareFittedHtmlPreview(src, value))
      .then(path => { if (!disposed) { const next=convertFileSrc(path); if (frameSourceRef.current && frameSourceRef.current !== next) setPreviousFrameSource(frameSourceRef.current); frameSourceRef.current=next; setFrameSource(next) } })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [src, localThreeRuntime, reloadToken])

  useEffect(() => {
    if (!live) return
    let disposed = false
    const check = () => void getLivePreviewRevision(src).then(revision => { if (disposed) return; if (!revisionRef.current) revisionRef.current=revision; else if (revisionRef.current !== revision) { revisionRef.current=revision; setReloadToken(value=>value+1) } }).catch(()=>undefined)
    check(); const timer=window.setInterval(check, 700)
    return () => { disposed=true; window.clearInterval(timer) }
  }, [src, live])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    // In the workspace panel, the flex item's own height is initially based on
    // the iframe. Measure its allocated parent instead, otherwise the first
    // layout pass can report 1 × 1 and shrink the document to invisibility.
    const measured = mode === 'panel' ? element.parentElement ?? element : element
    const update = () => {
      const next = { width: Math.max(1, measured.clientWidth), height: Math.max(1, measured.clientHeight) }
      setContainerSize(current => current.width === next.width && current.height === next.height ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(measured)
    const animationFrame = requestAnimationFrame(update)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(animationFrame)
    }
  }, [mode])

  useEffect(() => {
    const receiveSize = (event: MessageEvent) => {
      if (!isCanvasFrameSource(event.source, frameRef.current?.contentWindow, previousFrameRef.current?.contentWindow) || typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as { type?: string; width?: unknown; height?: unknown }
        if (message.type === 'bob-visual-size' && typeof message.width === 'number' && typeof message.height === 'number') {
          const next = { width: Math.max(1, Math.ceil(message.width)), height: Math.max(1, Math.ceil(message.height)) }
          setIntrinsic(current => current?.width === next.width && current.height === next.height ? current : next)
        } else if (message.type === 'bob-dom-selection') {
          const detail = message as unknown as { tag?:string; id?:string; classes?:string; text?:string }
          setSelection(`<${detail.tag ?? 'element'}${detail.id ? `#${detail.id}` : ''}${detail.classes ? `.${detail.classes.trim().replace(/\s+/g,'.')}` : ''}> ${detail.text ?? ''}`)
        }
      } catch { /* ignore messages not emitted by this frame */ }
    }
    window.addEventListener('message', receiveSize)
    return () => window.removeEventListener('message', receiveSize)
  }, [])

  const canvasViewport = mode === 'panel'
    ? { ...containerSize, height: Math.max(1, containerSize.height - 34 - (selection ? 27 : 0)) }
    : containerSize
  const { frameHeight, hasUsableViewport, scale, shouldScroll } = calculateFittedFrameLayout(intrinsic, canvasViewport, mode)

  const sendFit = () => {
    if (!hasUsableViewport) return
    const message = JSON.stringify({ type: 'bob-visual-fit', scale, scroll: shouldScroll })
    frameRef.current?.contentWindow?.postMessage(message, '*')
    previousFrameRef.current?.contentWindow?.postMessage(message, '*')
  }

  useEffect(() => {
    sendFit()
  }, [scale, frameSource, hasUsableViewport, shouldScroll])

  const sendInspector = () => {
    const message = JSON.stringify({ type: 'bob-dom-inspector', enabled: inspector })
    frameRef.current?.contentWindow?.postMessage(message, '*')
    previousFrameRef.current?.contentWindow?.postMessage(message, '*')
  }

  useEffect(() => {
    sendInspector()
  }, [inspector, frameSource, previousFrameSource, comparison])

  const onFrameLoad = () => {
    sendFit()
    sendInspector()
  }

  const exportZip = async () => {
    const destination = await chooseSavePath({ defaultPath: `${title.replace(/[^a-z0-9._-]+/gi,'-') || 'canvas'}.zip`, filters:[{name:'ZIP',extensions:['zip']}] })
    if (!destination) return
    setExporting(true); try { await exportLiveCanvasZip(src,destination) } finally { setExporting(false) }
  }

  return (
    <div ref={containerRef} className={`fitted-html-frame fitted-html-frame--${mode}`}>
      <div className="live-canvas-toolbar"><span className={live?'is-live':''}>● {live?t('canvas.live'):t('canvas.paused')}</span><button type="button" onClick={()=>setLive(value=>!value)}>{live?t('canvas.pause'):t('canvas.resume')}</button><button type="button" aria-pressed={inspector} className={inspector?'active':''} onClick={()=>{ setSelection(''); setInspector(value=>!value) }}>{t('canvas.inspect')}</button><button type="button" disabled={!previousFrameSource} className={comparison?'active':''} onClick={()=>setComparison(value=>!value)}>{t('canvas.diff')}</button><button type="button" disabled={exporting} onClick={()=>void exportZip()}>{exporting?'…':t('canvas.export')}</button></div>
      {(inspector || selection) && <div className={`live-canvas-selection${inspector&&!selection?' is-hint':''}`} role="status" title={selection || t('canvas.inspectHint')}>{selection || t('canvas.inspectHint')}</div>}
      <div className={`live-canvas-frames ${comparison&&previousFrameSource?'is-comparing':''}`}>
      {comparison && previousFrameSource && <iframe ref={previousFrameRef} src={previousFrameSource} title={`${title} — ${t('canvas.before')}`} sandbox="allow-scripts" referrerPolicy="no-referrer" scrolling="auto" style={{height:frameHeight}} onLoad={onFrameLoad} />}
      <iframe
        ref={frameRef}
        src={frameSource ?? 'about:blank'}
        title={title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        // Keep WebKit scrolling enabled from the first paint. Changing the
        // legacy iframe attribute after load is not reliable in WKWebView;
        // the injected document decides whether overflow is actually needed.
        scrolling="auto"
        style={{ height: frameHeight }}
        onLoad={onFrameLoad}
      />
      </div>
    </div>
  )
}
