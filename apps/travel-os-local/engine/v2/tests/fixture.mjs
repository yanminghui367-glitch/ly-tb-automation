import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from '../contract.mjs';

// Isolated local seller simulator. Never loaded by production CLI; no real account data.
export async function fixtureServer() {
  const published = new Map(); let posts = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/publish' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body); posts++;
      const id = String(100000 + posts); published.set(id, data.title);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id, title: data.title })); return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><meta charset="utf-8"><title>LOCAL FIXTURE</title>
      <body><h1 id="shop">合成测试店</h1><div id="risk"></div>
      <label>类目<input id="category"></label><label>标题<input id="title"></label>
      <label>价格<input id="price"></label><label>库存<input id="inventory"></label>
      ${['main','secondary','details'].map(g => `<input id="${g}" type="file" multiple><ul id="${g}-receipt"></ul>`).join('')}
      <button id="submit">发布合成商品</button><div id="success" hidden>发布成功 <span id="item-id"></span><a id="item-link">商品</a><span id="item-title"></span></div>
      <script>
      window.hits={};window.uploads={};window.scenario='normal';
      document.querySelectorAll('input').forEach(el=>el.addEventListener('input',()=>{window.hits[el.id]=(window.hits[el.id]||0)+1;if(window.scenario==='captcha'&&el.id==='title')document.querySelector('#risk').textContent='请完成验证码';}));
      ['main','secondary','details'].forEach(g=>document.querySelector('#'+g).addEventListener('change',e=>{window.uploads[g]=(window.uploads[g]||0)+1;const ul=document.querySelector('#'+g+'-receipt');ul.replaceChildren();for(const f of e.target.files){const li=document.createElement('li');li.textContent=f.name;ul.append(li);}}));
      document.querySelector('#submit').onclick=async()=>{const title=document.querySelector('#title').value;const r=await fetch('/publish',{method:'POST',body:JSON.stringify({title})});const item=await r.json();window.lastItem=item;if(window.scenario==='unknown')return;window.showResult(item);};
      window.showResult=item=>{document.querySelector('#item-id').textContent=item.id;document.querySelector('#item-link').href='/item?id='+item.id;document.querySelector('#item-title').textContent=item.title;document.querySelector('#success').hidden=false;};
      </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/draft`;
  return { url, published, posts: () => posts, close: () => new Promise(resolve => server.close(resolve)) };
}

export function profile(url) {
  return { environment: 'LOCAL_FIXTURE', version: 'fixture-v1', reviewed: true, evidence: 'SYNTHETIC TEST ONLY',
    shop: { id: 'fixture-shop', name: '合成测试店' }, draftUrl: url, identity: { selector: '#shop', expected: '合成测试店' },
    fields: [
      ...[['category','business.category_path'], ['title','listing.title'], ['price','business.price_cny'], ['inventory','business.inventory']].map(([id, source]) => ({ id, source, selector: `#${id}`, action: 'fill', reviewed: true, verify: { selector: `#${id}`, kind: 'value' } })),
      ...['main','secondary','details'].map(id => ({ id, source: `assets.${id}`, selector: `#${id}`, action: 'upload', reviewed: true, verify: { selector: `#${id}-receipt li`, kind: 'uploadedNames' } }))
    ], submit: { selector: '#submit' }, result: { success: '#success', itemId: '#item-id', itemLink: '#item-link', title: '#item-title' } };
}
export async function taskFixture(dir, index = 1) {
  await mkdir(dir, { recursive: true });
  const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=', 'base64');
  const files = [];
  for (let i = 0; i < 6; i++) { const path = join(dir, `${i}.png`); await writeFile(path, data); files.push({ path, sha256: hash(data) }); }
  const title = `测试城市${index}服务咨询`;
  return { schemaVersion: 2, shopId: 'fixture-shop', listing: { type: 'city', country: '测试国', city: `测试城市${index}`, title, titleVersions: [title, `${title}备选`], selectedTitleIndex: 0 },
    source: { fixture: true, row: index }, assets: { main: [files[0]], secondary: files.slice(1, 5), details: [files[5]] },
    business: { category_path: '测试类目', price_cny: 10, inventory: 1 },
    evidence: Object.fromEntries(['category_and_attributes','supply_and_qualification','price_refund_fulfillment','destination_assets','dry_run_mapping'].map(k => [k, 'SYNTHETIC ONLY'])) };
}
