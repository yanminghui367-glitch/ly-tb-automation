import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const publicFiles = new Map([
  ['publishing-rules-ui.js', 'text/javascript; charset=utf-8'],
  ['publishing-rules.css', 'text/css; charset=utf-8'],
  ['task-view-model.mjs', 'text/javascript; charset=utf-8'],
  ['tasks.css', 'text/css; charset=utf-8'],
  ['overview.css', 'text/css; charset=utf-8'],
  ['typography.css', 'text/css; charset=utf-8'],
  ['travel-os.html', 'text/html; charset=utf-8'],
  ['travel-os.js', 'text/javascript; charset=utf-8'],
  ['travel-os.css', 'text/css; charset=utf-8'],
  ['travel-globe-ui.css', 'text/css; charset=utf-8'],
  ['index.html', 'text/html; charset=utf-8'],
  ['travel-home.html', 'text/html; charset=utf-8'],
  ['travel-home.js', 'text/javascript; charset=utf-8'],
  ['travel-globe.js', 'text/javascript; charset=utf-8'],
  ['globe-layout.js', 'text/javascript; charset=utf-8'],
  ['travel-home.css', 'text/css; charset=utf-8'],
  ['legacy.html', 'text/html; charset=utf-8'],
  ['product.js', 'text/javascript; charset=utf-8'],
  ['product.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['source-workflow.js', 'text/javascript; charset=utf-8'],
  ['source-workflow.css', 'text/css; charset=utf-8'],
  ['batch-workflow.js', 'text/javascript; charset=utf-8'],
  ['batch-workflow.css', 'text/css; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['console.css', 'text/css; charset=utf-8'],
  ['premium.css', 'text/css; charset=utf-8'],
  ['ui-polish.css', 'text/css; charset=utf-8'],
  ['favicon.svg', 'image/svg+xml'],
  ['product-package-template.json', 'application/json; charset=utf-8']
]);
const homeAssets = new Map([
  ...['overview-santorini.png','overview-thailand.png','overview-australia.png'].map(name=>['assets/travel-os/'+name,'image/png']),
  ['assets/fonts/noto-sans-sc-variable.woff2', 'font/woff2'],
  ['assets/fonts/NotoSansSC-NOTICE.txt', 'text/plain; charset=utf-8'],
  ...['earth-scene.png','tokyo-atmosphere.png','space-backdrop.png','workspace-backdrop.png','brand-reference.png','earth-clouds.png'].map(name=>['assets/travel-os/'+name,'image/png']),
  ...['earth-day.jpg','earth-night.jpg','earth-lights-2016.jpg','earth-bump.jpg'].map(name=>['assets/travel-os/'+name,'image/jpeg']),
  ...['three.module.js','three.core.js','orbit-controls.js'].map(name=>['assets/travel-os/vendor/'+name,'text/javascript; charset=utf-8']),
  ...['plus','minus','map-pin','magnifying-glass','arrow-right','compass','globe-hemisphere-east','upload-simple','check-circle','warning-circle','arrow-square-out','images','list-checks','x','arrow-clockwise'].map(name=>['assets/travel-os/icons/'+name+'.svg','image/svg+xml'])
]);
const safeSegment = value => value && !value.startsWith('.') && !/[\u0000-\u001f\u007f<>:"/\\|?*%#]/u.test(value) && !/[. ]$/.test(value);

function resource(rawUrl) {
  // Inspect the original request before URL normalization can erase dot segments.
  const rawPath = String(rawUrl || '').split('?')[0];
  if (!rawPath.startsWith('/') || /%2f|%5c/i.test(rawPath)) return null;
  let path;
  try { path = decodeURIComponent(rawPath); } catch { return null; }
  const parts = (path === '/' ? '/travel-home.html' : path).slice(1).split('/');
  if (!parts.every(safeSegment)) return null;
  if (parts.length === 1 && publicFiles.has(parts[0])) return { parts, type: publicFiles.get(parts[0]) };
  if(homeAssets.has(parts.join('/')))return {parts,type:homeAssets.get(parts.join('/'))};
  // Generated screenshots only: no generic output, JSON, HTML or directory serving.
  const screenshot = parts[0] === 'output' && (
    (parts[1] === 'tasks' && parts.length === 4) ||
    (parts[1] === 'mapping-evidence' && parts.length === 3)
  ) && parts.at(-1).endsWith('.png');
  return screenshot ? { parts, type: 'image/png' } : null;
}

function send(res, method, status, body = 'Not found', headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(method === 'HEAD' ? undefined : body);
}

export function createStaticHandler(root) {
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, req.method, 405, 'Method not allowed', { allow: 'GET, HEAD' });
    const allowed = resource(req.url);
    if (!allowed) return send(res, req.method, 404);
    try {
      const base = await realpath(root);
      let file = base;
      for (const [index, part] of allowed.parts.entries()) {
        file = join(file, part);
        const info = await lstat(file);
        // Reject symlinks and Windows junctions at every component, even in-root links.
        if (info.isSymbolicLink() || (index < allowed.parts.length - 1 ? !info.isDirectory() : !info.isFile())) return send(res, req.method, 404);
      }
      const canonical = await realpath(file);
      const rel = relative(base, canonical);
      if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || rel !== allowed.parts.join(sep)) return send(res, req.method, 404);
      const bytes = await readFile(canonical);
      return send(res, req.method, 200, bytes, { 'content-type': allowed.type, 'content-length': bytes.length });
    } catch {
      // Missing, unreadable or changed paths must not leak filesystem details.
      return send(res, req.method, 404);
    }
  };
}
