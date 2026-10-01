import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const templateFile = new URL('../workbench/product-package-template.json', import.meta.url);

// Reuse the workbench's actual import/validation contract without starting HTTP or Chrome.
async function importer() {
  const previous = process.env.WORKBENCH_NO_LISTEN;
  process.env.WORKBENCH_NO_LISTEN = '1';
  try { return (await import('../workbench/server.mjs')).collectReadyPackages; }
  finally {
    if (previous === undefined) delete process.env.WORKBENCH_NO_LISTEN;
    else process.env.WORKBENCH_NO_LISTEN = previous;
  }
}

export async function generateReviewPackages({ source, files, output }) {
  if (!source || !output || !Array.isArray(files) || !files.length) throw new Error('必须指定 source、files 和全新的 output 目录。');
  if (files.length > 300) throw new Error('单批最多 300 条，请拆分清单。');
  const sourceDir = await realpath(path.resolve(source));
  const outputDir = path.resolve(output);
  const names = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !file || /[\\/]/.test(file) || !/\.json$/i.test(file) || ['manifest.json', 'preflight-report.json'].includes(file.toLowerCase())) throw new Error(`只接受源目录内明确指定的商品包 JSON 文件名：${file}`);
    if (names.has(file.toLowerCase())) throw new Error(`重复选择文件：${file}`);
    names.add(file.toLowerCase());
  }
  const template = await readJson(templateFile);
  const collect = await importer();
  const generatedAt = new Date().toISOString();
  const prepared = [];
  const identities = new Set();
  for (const file of files) {
    const sourceFile = await realpath(path.join(sourceDir, file));
    if (path.dirname(sourceFile).toLowerCase() !== sourceDir.toLowerCase()) throw new Error(`源文件越出指定目录：${file}`);
    const bytes = await readFile(sourceFile);
    const original = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!object(original) || !object(original.listing) || !object(original.assets)) throw new Error(`不是有效商品包：${file}`);
    if (!['READY', 'NEEDS_REVIEW'].includes(original.status)) throw new Error(`不支持源状态：${file}`);
    if (original.result?.item_id || original.result?.item_url || (original.result?.state && original.result.state !== 'not_started')) throw new Error(`已有执行或发布结果，不可生成新的待上架副本：${file}`);
    if (original.skus || original.sku || original.listing.skus || original.listing.sku) throw new Error(`不支持 SKU：${file}`);
    const pkg = structuredClone(template);
    pkg.source = structuredClone(original.source || {});
    pkg.listing = { ...pkg.listing, ...original.listing };
    if (!Array.isArray(original.listing.title_versions)) pkg.listing.title_versions = [original.listing.title || '', ''];
    // No automatic selection, title rewriting, country inference, or review promotion.
    pkg.status = 'NEEDS_REVIEW';
    pkg.release_profile = { ...pkg.release_profile, ...original.release_profile };
    const assets = original.assets;
    const secondary = assets.secondary_images ?? assets.secondary_image_set?.files ?? [];
    const resolveImage = value => {
      if (typeof value !== 'string') throw new Error(`素材路径必须是字符串：${file}`);
      if (!value || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
      return path.resolve(path.dirname(sourceFile), value);
    };
    if (!Array.isArray(secondary) || !Array.isArray(assets.detail_images ?? [])) throw new Error(`素材顺序必须是数组：${file}`);
    pkg.assets = {
      main_image: resolveImage(assets.main_image ?? ''),
      secondary_images: secondary.map(resolveImage),
      detail_images: (assets.detail_images ?? []).map(resolveImage),
    };
    const identity = JSON.stringify([pkg.release_profile.shop_name.trim(), pkg.listing.location_type, String(pkg.listing.destination).trim()]);
    if (identities.has(identity)) throw new Error(`同店同类型目的地重复，须人工保留一条：${file}`);
    identities.add(identity);
    pkg.generation = { mode: 'REVIEW', live_enabled: false, generated_at: generatedAt, source_file: sourceFile, source_sha256: digest(bytes), source_status: original.status, note: '原始业务字段仅转录；审核证据与页面映射须重新核验。' };
    const imported = collect([{ sourceFile: path.join(outputDir, file), content: pkg }]);
    if (imported.jobs.length !== 1) throw new Error(`工作台无法接纳：${file}`);
    const job = imported.jobs[0];
    const fileIssues = [];
    for (const image of [pkg.assets.main_image, ...pkg.assets.secondary_images, ...pkg.assets.detail_images].filter(Boolean)) {
      const info = await stat(image).catch(() => null);
      if (!info?.isFile() || info.size === 0) fileIssues.push(`素材不是可读取的非空文件：${image}`);
    }
    const issues = [...new Set([...job.packageValidation.issues, ...fileIssues])];
    pkg.checks = [{ name: 'current_contract_and_local_files', passed: issues.length === 0, detail: issues.length ? issues.join('；') : '结构与本机文件检查通过；不代表图像内容、服务供给或平台审核通过' }];
    prepared.push({ file, pkg, report: { file, destination: pkg.listing.destination, source_sha256: digest(bytes), status: pkg.status, structure_and_files_passed: issues.length === 0, issues, review_blockers: job.releaseBlockers, mapping_issues: job.mappingValidation.issues, manual_checks: ['两个标题的真实服务范围及当前类目字数', '主图、4 张副图和固定详情的内容、顺序、目的地一致性', '历史业务字段的类目、属性、价格、库存、物流与供给证据', '淘宝线上是否已有同目的地链接'] } });
  }
  // Prepare every input before writing; an existing output directory is never overwritten.
  await mkdir(outputDir);
  const report = { generated_at: generatedAt, mode: 'REVIEW', live_enabled: false, total: prepared.length, ready: 0, needs_review: prepared.length, packages: prepared.map(item => item.report) };
  for (const item of prepared) await writeFile(path.join(outputDir, item.file), `${JSON.stringify(item.pkg, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(outputDir, 'preflight-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  const lines = ['# 商品包生成预检', '', `生成 ${report.total} 条审核副本；READY 0；NEEDS_REVIEW ${report.needs_review}。`, '', '文件存在不等于图像内容正确或可发布。未导入队列、未连接浏览器、未提交。', '源包与历史业务资料未改写；副本的发布审核证据和页面映射重新留空。', '本报告含本机路径，仅供本地审核。', ''];
  for (const item of prepared) lines.push(`## ${item.file}`, '', `来源 SHA-256：${item.report.source_sha256}`, '', ...item.report.issues.map(issue => `- 待修复：${issue}`), ...item.report.review_blockers.map(issue => `- 发布阻塞：${issue}`), ...item.report.manual_checks.map(issue => `- 待人工确认：${issue}`), '');
  await writeFile(path.join(outputDir, 'preflight-report.md'), `${lines.join('\n')}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { source: { type: 'string' }, file: { type: 'string', multiple: true }, output: { type: 'string' } } });
    const report = await generateReviewPackages({ source: values.source, files: values.file, output: values.output });
    console.log(JSON.stringify({ total: report.total, needs_review: report.needs_review, ready: 0, output: path.resolve(values.output) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
