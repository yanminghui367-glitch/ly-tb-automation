import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}
export const hash = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(canonical(x))).digest('hex');
export const taskHash = task => hash(task);
export const listingKey = task => JSON.stringify([task.shopId, task.listing.type, task.listing.country, task.listing.city || '']);
export const resolveValue = (task, path) => String(path).split('.').reduce((o, k) => o?.[k], task);
export class EngineError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
export const requireThat = (value, code) => { if (!value) throw new EngineError(code); };
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
export function taskIssues(t, { verifyFiles = true } = {}) {
  const errors = [...(t.adapterIssues || [])];
  if (t.schemaVersion !== 2 || !nonempty(t.shopId)) errors.push('INVALID_TASK_SCHEMA');
  const l = t.listing || {};
  if (!['city', 'country'].includes(l.type) || !nonempty(l.country) || (l.type === 'city' && !nonempty(l.city)) || (l.type === 'country' && l.city)) errors.push('INVALID_DESTINATION');
  if (!nonempty(l.title) || !l.title.includes(l.type === 'city' ? l.city : l.country)) errors.push('TITLE_DESTINATION_MISMATCH');
  if (!Array.isArray(l.titleVersions) || l.titleVersions.length !== 2 || new Set(l.titleVersions).size !== 2 || !l.titleVersions.every(nonempty) || ![0, 1].includes(l.selectedTitleIndex) || l.titleVersions[l.selectedTitleIndex] !== l.title) errors.push('TITLE_SELECTION_REQUIRED');
  for (const [group, count] of [['main', 1], ['secondary', 4], ['details', null]]) {
    const items = t.assets?.[group];
    if (!Array.isArray(items) || !items.length || (count && items.length !== count)) { errors.push(`ASSET_COUNT_${group}`); continue; }
    if (new Set(items.map(a => a.path)).size !== items.length) errors.push(`ASSET_DUPLICATE_${group}`);
    for (const a of items) {
      if (!nonempty(a.path) || !/\.(png|jpe?g|webp)$/i.test(a.path) || !/^[a-f0-9]{64}$/.test(a.sha256 || '')) { errors.push('INVALID_ASSET'); continue; }
      if (verifyFiles) try { if (hash(readFileSync(a.path)) !== a.sha256) errors.push('ASSET_HASH_CHANGED'); } catch { errors.push('ASSET_NOT_FOUND'); }
    }
  }
  for (const key of ['category_and_attributes', 'supply_and_qualification', 'price_refund_fulfillment', 'destination_assets', 'dry_run_mapping']) {
    const e = t.evidence?.[key];
    if (!nonempty(typeof e === 'string' ? e : e?.source)) errors.push(`EVIDENCE_${key}`);
  }
  if (!nonempty(t.business?.category_path) || !Number.isFinite(Number(t.business?.price_cny)) || Number(t.business.price_cny) <= 0 || !Number.isInteger(Number(t.business?.inventory)) || Number(t.business.inventory) < 0) errors.push('BUSINESS_FIELDS_REQUIRED');
  if (verifyFiles) for (const source of [t.source?.workbook ? { path: t.source.workbook, sha256: t.source.sha256 } : null, t.source?.package].filter(Boolean)) {
    try { if (hash(readFileSync(source.path)) !== source.sha256) errors.push('SOURCE_HASH_CHANGED'); } catch { errors.push('SOURCE_NOT_FOUND'); }
  }
  return [...new Set(errors)];
}

export function validateProfile(p, task, mode) {
  requireThat(p?.version && p.shop?.id === task.shopId && p.shop.name, 'PROFILE_SHOP_MISMATCH');
  requireThat(p.environment === 'LOCAL_FIXTURE' || p.environment === 'TAOBAO', 'INVALID_ENVIRONMENT');
  const url = new URL(p.draftUrl);
  requireThat(p.environment === 'LOCAL_FIXTURE' ? url.protocol === 'http:' && url.hostname === '127.0.0.1' : url.protocol === 'https:' && ['myseller.taobao.com', 'seller.taobao.com'].includes(url.hostname), 'UNAPPROVED_ORIGIN');
  requireThat(p.identity?.selector && p.identity.expected === p.shop.name, 'IDENTITY_MAPPING_REQUIRED');
  requireThat(p.reviewed === true && nonempty(p.evidence), 'PROFILE_NOT_REVIEWED');
  requireThat(Array.isArray(p.fields) && p.fields.length > 0 && new Set(p.fields.map(f => f.id)).size === p.fields.length, 'INVALID_FIELD_LIST');
  for (const id of ['category', 'title', 'price', 'inventory', 'main', 'secondary', 'details']) requireThat(p.fields.some(f => f.id === id), `MISSING_FIELD_${id}`);
  const canonicalSources = { category: 'business.category_path', title: 'listing.title', price: 'business.price_cny', inventory: 'business.inventory', main: 'assets.main', secondary: 'assets.secondary', details: 'assets.details' };
  for (const f of p.fields) {
    requireThat(f.reviewed === true && nonempty(f.selector) && nonempty(f.source) && ['fill', 'select', 'upload', 'manual'].includes(f.action), 'INVALID_FIELD');
    requireThat(f.verify?.selector && ['value', 'text', 'uploadedNames'].includes(f.verify.kind), 'POSTCONDITION_REQUIRED');
    if (canonicalSources[f.id]) requireThat(f.source === canonicalSources[f.id], `WRONG_SOURCE_${f.id}`);
    const value = resolveValue(task, f.source);
    requireThat(value !== undefined && value !== null && value !== '', `MISSING_VALUE_${f.id}`);
    if (f.action === 'upload') requireThat(Array.isArray(value) && f.verify.kind === 'uploadedNames', 'UPLOAD_RECEIPT_REQUIRED');
  }
  if (mode === 'LIVE') requireThat(p.submit?.selector && p.result?.success && p.result?.itemId && p.result?.itemLink && p.result?.title, 'RESULT_MAPPING_REQUIRED');
}

export function validateRelease(task, profile, release, mode) {
  const issues = taskIssues(task);
  requireThat(!issues.length, `TASK_BLOCKED:${issues.join(',')}`);
  validateProfile(profile, task, mode);
  if (profile.environment === 'LOCAL_FIXTURE') return;
  requireThat(release?.shopId === task.shopId && release.taskHashes?.includes(taskHash(task)) && release.profileHash === hash(profile), 'RELEASE_SCOPE_MISMATCH');
  requireThat(Date.parse(release.expiresAt) > Date.now() && nonempty(release.authorizationReference) && nonempty(release.reviewer) && nonempty(release.onlineDuplicateEvidence), 'RELEASE_EVIDENCE_REQUIRED');
  requireThat(release.p4Ready === true && nonempty(release.qaEvidence), 'P4_GATE_REQUIRED');
  if (mode === 'LIVE') requireThat(release.liveAuthorized === true && nonempty(release.p4Evidence) && nonempty(release.submitQaEvidence), 'P5_GATE_REQUIRED');
}
