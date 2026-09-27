import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserEnvironment, projectProfile } from "./browser-environment.mjs";
import { SourceWorkflow } from "./source-workflow.mjs";
import { BatchWorkflow } from "./batch-workflow.mjs";
import { ProductApi, executionRoute } from "./product-api.mjs";
import { TravelOsApi } from "./travel-os-api.mjs";
import {redact} from "./product-state.mjs";
import { createHash, randomUUID } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { createSessionGuard, SessionError } from "./session-guard.mjs";
import { createStaticHandler } from "./static-files.mjs";
import { networkAccess } from "./network-access.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WORKBENCH_PORT || 4318), RUNTIME = join(ROOT, ".runtime"), STATE_FILE = join(RUNTIME, "jobs.json"), SHOPS_FILE = join(RUNTIME, "shops.json"), TASK_ARTIFACTS = join(ROOT, "output", "tasks"), MAPPING_ARTIFACTS = join(ROOT, "output", "mapping-evidence"), STAGED_IMPORTS = join(RUNTIME, "imports");
const DEFAULT_FOLDER = resolve(ROOT, "..", "output", "batch-001-first-20"), SELLER_HOME = "https://myseller.taobao.com/home.htm/QnworkbenchHome/";
const network = networkAccess({port:PORT,address:process.env.WORKBENCH_LAN_ADDRESS||''});
const chromeCandidates = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"];
const defaultShop = { id: "wuzhou-changyou", name: "五洲畅游", port: 9222, profileDir: projectProfile("wuzhou-changyou"), loginHint: "", createdAt: "2026-08-30T00:00:00.000Z" };
const browserEnvironment = new BrowserEnvironment({ portAvailable: assertPortAvailable });
const sessionGuard = createSessionGuard({ connector: shop => browserEnvironment.browser(shop), risk: page => pageRisk(page, true) });
  let sourceWorkflow;
  let batchWorkflow;
  const sources = () => sourceWorkflow ||= new SourceWorkflow(browserEnvironment);
  const batches = () => batchWorkflow ||= new BatchWorkflow(sources());
  let productApi;
  const product = () => productApi ||= context().then(({shop})=>new ProductApi({batch:batches(),source:sources(),owner:browserEnvironment,shop,launch:launchChrome,runtime:RUNTIME}));
  let travelOsApi;
  const travelOs = () => travelOsApi ||= new TravelOsApi({product,shops:loadShops,browser:browserEnvironment,launch:launchChrome,runtime:RUNTIME,addShop:async name=>{
    const shops=await loadShops(),id=`shop-${randomUUID().slice(0,8)}`;
    const shop={id,name,loginHint:'',port:nextShopPort(shops),profileDir:projectProfile(id),createdAt:new Date().toISOString()};
    shops.push(shop);await saveShops(shops);return shop;
  }});
const releaseEvidenceRules = [
  ["category_and_attributes", "淘宝真实类目及完整属性"],
  ["supply_and_qualification", "真实供给与所需资质"],
  ["price_refund_fulfillment", "价格、退改、售后与履约"],
  ["destination_assets", "目的地与主图、副图、详情一致性"],
  ["dry_run_mapping", "当前页面的 DRY_RUN 字段映射证据"]
];

const MAX_REQUEST_BYTES = 115 * 1024 * 1024, MAX_STAGED_ASSET_BYTES = 80 * 1024 * 1024, MAX_STAGED_ASSET_FILE_BYTES = 12 * 1024 * 1024;
class ClientInputError extends Error { constructor(message) { super(message); this.statusCode = 400; } }
function json(res, code, payload) { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(payload)); }
function text(res, code, value, type = "text/plain; charset=utf-8") { res.writeHead(code, { "content-type": type }); res.end(value); }
function downloadJson(res, filename, payload) { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" }); res.end(JSON.stringify(payload, null, 2)); }
async function body(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > MAX_REQUEST_BYTES) throw new ClientInputError("本次上传超过 110MB，请拆分商品包和素材后重试。"); chunks.push(chunk); } try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch { throw new ClientInputError("请求内容不是有效 JSON。") } }
function chromePath() { return chromeCandidates.find(existsSync) || null; }
function cdpUrl(shop) { return `http://127.0.0.1:${shop.port}`; }
function isTaobaoUrl(value) { try { const url = new URL(String(value || "")); return url.protocol === "https:" && (url.hostname === "taobao.com" || url.hostname.endsWith(".taobao.com")); } catch { return false; } }
function packageId(pkg, file) { return `${pkg.listing?.destination_code || pkg.listing?.destination || basename(file)}-${pkg.source?.row || basename(file)}`; }
function hasEvidence(value) { return Boolean(typeof value === "string" ? value.trim() : value?.source || value?.reference || value?.url); }
function releaseBlockers(reviewEvidence = {}) { return releaseEvidenceRules.filter(([key]) => !hasEvidence(reviewEvidence[key])).map(([, label]) => label); }
const requiredMappingFields = new Set(["category", "title", "price", "main_images", "secondary_images", "detail_images"]);
const supportedInteractions = new Set(["fill", "select", "upload", "manual"]);
const supportedLocatorStrategies = new Set(["css", "label", "text", "testid", "role"]);
const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const platformRiskTerms = ["验证码", "图形验证", "短信验证", "滑块", "滑块验证", "拖动滑块", "请拖动滑块", "向右滑动", "滑动验证", "请滑动验证", "人机验证", "机器人验证", "安全验证", "请完成验证", "请进行安全验证", "行为验证", "异常访问", "访问频繁", "登录失效", "captcha", "slider", "drag the slider", "slide to verify", "verify your identity", "robot verification", "security check", "risk control"];
function detectPlatformRisk(value = "") { const page = String(value || "").toLowerCase(); return platformRiskTerms.find(term => page.includes(term.toLowerCase())) || ""; }
async function pageRisk(page, strict = false) {
  const unreadable = () => { if (strict) throw new SessionError("无法读取页面风控状态，请重新核验。"); return ""; };
  const pageText = await page.locator("body").innerText({ timeout: 2000 }).catch(unreadable);
  const pageTitle = await page.title().catch(unreadable);
  const frames = typeof page.frames === "function" ? page.frames() : [];
  const frameSignals = await Promise.all(frames.map(async frame => {
    const frameText = await frame.locator("body").innerText({ timeout: 2000 }).catch(unreadable);
    const frameUrl = typeof frame.url === "function" ? frame.url() : "";
    return `${frameText}\n${frameUrl}`;
  }));
  return detectPlatformRisk(`${pageText}\n${pageTitle}\n${page.url()}\n${frameSignals.join("\n")}`);
}
function mappingValidation(mapping) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return { valid: false, issues: ["缺少版本化字段映射"] };
  const issues = [];
  if (mapping.platform !== "taobao") issues.push("字段映射平台必须为 taobao");
  if (!String(mapping.version || "").trim()) issues.push("缺少字段映射版本");
  if (!hasEvidence(mapping.verified_evidence)) issues.push("缺少字段映射验证证据");
  if (!isTaobaoUrl(mapping.draft_url)) issues.push("草稿页地址必须是已核验的 HTTPS 淘宝域名");
  if (!Array.isArray(mapping.fields)) issues.push("缺少字段映射列表");
  const ids = new Set();
  for (const field of Array.isArray(mapping.fields) ? mapping.fields : []) {
    if (!String(field?.id || "").trim()) { issues.push("字段映射存在未命名字段"); continue; }
    if (ids.has(field.id)) issues.push(`${field.id} 字段映射重复`);
    ids.add(field.id);
    const locator = field.locator || {};
    if (!String(locator.strategy || "").trim() || !String(locator.value || "").trim()) issues.push(`${field.id} 缺少定位器`);
    if (locator.strategy && !supportedLocatorStrategies.has(locator.strategy)) issues.push(`${field.id} 使用了不支持的定位方式`);
    if (locator.strategy === "role" && !String(locator.role || "").trim()) issues.push(`${field.id} 的 role 定位器缺少 role`);
    if (!supportedInteractions.has(field.interaction)) issues.push(`${field.id} 交互方式必须是 fill、select、upload 或 manual`);
    if (field.reviewed !== true) issues.push(`${field.id} 尚未逐项核验`);
    if (field.required !== undefined && typeof field.required !== "boolean") issues.push(`${field.id} 的 required 必须为布尔值`);
    if (field.id === "publish" || field.id === "submit") issues.push("字段映射不得包含发布或提交动作");
  }
  for (const id of requiredMappingFields) if (!ids.has(id)) issues.push(`缺少 ${id} 字段映射`);
  return { valid: issues.length === 0, issues };
}
function mappingUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("字段映射必须是 JSON 对象。");
  if (JSON.stringify(value).length > 30000) throw new Error("字段映射不能超过 30KB。");
  if (value.fields !== undefined && (!Array.isArray(value.fields) || value.fields.length > 40)) throw new Error("fields 必须是数组且最多 40 项。");
  for (const field of value.fields || []) {
    if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error("fields 中每一项必须是对象。");
    if (String(field.id || "").length > 80 || String(field.source || "").length > 160) throw new Error("字段 id 或 source 过长。");
    if (String(field.locator?.strategy || "").length > 40 || String(field.locator?.value || "").length > 500 || String(field.locator?.role || "").length > 80) throw new Error("定位器过长。");
    if (field.reviewed !== undefined && typeof field.reviewed !== "boolean") throw new Error("字段 reviewed 必须是布尔值。");
  }
  return value;
}
const mappingFieldLabels = { category: "类目", title: "标题", price: "价格", main_images: "主图", secondary_images: "4 张副图", detail_images: "详情图" };
function mappingSnapshot(mapping = {}) {
  // The executor visits every mapping field in array order, including extra attributes.
  // Freeze the same sequence and missing-value policy; never sort or filter it.
  const fields = (Array.isArray(mapping.fields) ? mapping.fields : []).map(field => ({ id: String(field?.id || ""), source: String(field?.source || ""), locator: { strategy: String(field?.locator?.strategy || ""), value: String(field?.locator?.value || ""), ...(field?.locator?.role ? { role: String(field.locator.role) } : {}) }, interaction: String(field?.interaction || ""), reviewed: field?.reviewed === true, required: field?.required !== false }));
  return { snapshotVersion: 2, platform: String(mapping.platform || ""), version: String(mapping.version || ""), verifiedEvidence: String(mapping.verified_evidence || ""), draftUrl: String(mapping.draft_url || ""), fields };
}
function mappingFingerprint(snapshot) { return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 20); }
function mappingSnapshotChanges(previous = {}, current = {}) {
  const changes = [];
  if (previous.snapshotVersion !== current.snapshotVersion) changes.push("映射快照格式（需重新核验并新建任务）");
  if (previous.platform !== current.platform) changes.push("映射平台");
  if (previous.version !== current.version) changes.push("映射版本");
  if (previous.verifiedEvidence !== current.verifiedEvidence) changes.push("页面验证证据");
  if (previous.draftUrl !== current.draftUrl) changes.push("草稿页地址");
  const before = new Map((previous.fields || []).map(field => [field.id, field])), after = new Map((current.fields || []).map(field => [field.id, field]));
  if (JSON.stringify((previous.fields || []).map(field => field.id)) !== JSON.stringify((current.fields || []).map(field => field.id))) changes.push("字段清单或执行顺序");
  for (const id of new Set([...before.keys(), ...after.keys()])) if (JSON.stringify(before.get(id) || null) !== JSON.stringify(after.get(id) || null)) changes.push(mappingFieldLabels[id] || id);
  return changes;
}
function stableSnapshotValue(value) {
  if (Array.isArray(value)) return value.map(stableSnapshotValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSnapshotValue(value[key])]));
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  return null;
}
function packageExecutionSnapshot(job = {}) {
  return stableSnapshotValue({ status: job.status || "", listing: job.listing || {}, assets: job.assets || {}, releaseProfile: job.profile || {}, reviewEvidence: job.reviewEvidence || {} });
}
function packageExecutionFingerprint(snapshot) { return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 20); }
function packageExecutionSnapshotChanges(previous = {}, current = {}) {
  const changes = [];
  if (previous.status !== current.status) changes.push("商品包状态");
  if (JSON.stringify(previous.listing) !== JSON.stringify(current.listing)) changes.push("目的地或标题");
  if (JSON.stringify(previous.assets) !== JSON.stringify(current.assets)) changes.push("商品素材");
  if (JSON.stringify(previous.releaseProfile) !== JSON.stringify(current.releaseProfile)) changes.push("类目、价格或履约资料");
  if (JSON.stringify(previous.reviewEvidence) !== JSON.stringify(current.reviewEvidence)) changes.push("审核证据");
  return changes;
}
function titleVersions(listing = {}, fallbackTitle = "") {
  const raw = listing.title_versions ?? listing.title_candidates ?? listing.titles ?? (fallbackTitle ? [fallbackTitle] : []);
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map(item => typeof item === "string" ? item.trim() : String(item?.title || "").trim()).filter(Boolean);
}
function localAssetPath(job, value) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (isAbsolute(source)) return source;
  return isAbsolute(String(job.sourceFile || "")) ? resolve(dirname(job.sourceFile), source) : "";
}
function imageFileIssues(job, label, values) {
  const files = values.filter(Boolean).map(value => localAssetPath(job, value));
  if (!files.length) return [];
  const inaccessible = files.filter(file => !file || !existsSync(file)).length;
  const unsupported = files.filter(file => file && existsSync(file) && !supportedImageExtensions.has(extname(file).toLowerCase())).length;
  return [
    ...(inaccessible ? [`${label}有 ${inaccessible} 张文件无法在本机读取`] : []),
    ...(unsupported ? [`${label}仅支持 PNG、JPG、JPEG 或 WEBP 图片`] : [])
  ];
}
function stagedTarget(root, sourceFile) {
  const requested = String(sourceFile || "").trim().replace(/\\/g, "/");
  if (!requested || requested.length > 700 || isAbsolute(requested)) throw new ClientInputError("上传文件路径无效。");
  const target = resolve(root, requested), relativeTarget = relative(root, target);
  if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new ClientInputError("上传文件不得写出工作台暂存目录。");
  return target;
}
function base64File(value, sourceFile) {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(MAX_STAGED_ASSET_FILE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ClientInputError(`${basename(String(sourceFile || "素材"))} 的素材内容无效。`);
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.length > MAX_STAGED_ASSET_FILE_BYTES || decoded.toString("base64") !== value) throw new ClientInputError(`${basename(String(sourceFile || "素材"))} 的素材内容无效或过大。`);
  return decoded;
}
async function stageUploadedBundle(packages, assets) {
  if (!Array.isArray(packages) || !packages.length) throw new ClientInputError("请选择至少一个 JSON 商品包。");
  if (packages.length > 300) throw new ClientInputError("一次最多暂存 300 个商品包，请分批导入。");
  if (!Array.isArray(assets) || assets.length > 1200) throw new ClientInputError("一次最多暂存 1200 个素材文件，请分批导入。");
  const root = join(STAGED_IMPORTS, `upload-${randomUUID()}`), records = [];
  await mkdir(root, { recursive: true });
  for (const record of packages) {
    const sourceFile = String(record?.sourceFile || ""), content = String(record?.content || "");
    if (extname(sourceFile).toLowerCase() !== ".json") throw new ClientInputError("商品包必须是 JSON 文件。");
    if (!content || Buffer.byteLength(content, "utf8") > 1024 * 1024) throw new ClientInputError(`${basename(sourceFile || "商品包")} 内容为空或超过 1MB。`);
    const target = stagedTarget(root, sourceFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    records.push({ sourceFile: target, content });
  }
  let assetBytes = 0;
  for (const asset of assets) {
    const sourceFile = String(asset?.sourceFile || ""), extension = extname(sourceFile).toLowerCase();
    if (!supportedImageExtensions.has(extension)) throw new ClientInputError("暂存素材只支持 PNG、JPG、JPEG 或 WEBP 图片。");
    const content = base64File(asset?.contentBase64, sourceFile);
    assetBytes += content.length;
    if (assetBytes > MAX_STAGED_ASSET_BYTES) throw new ClientInputError("本次素材合计超过 80MB，请拆分商品包后重试。");
    const target = stagedTarget(root, sourceFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { root, records, assetsStaged: assets.length, assetBytes };
}
function applyPackageCompletion(job, completion = {}) {
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) return job;
  const listing = { ...(job.listing || {}) }, assets = { ...(job.assets || {}) };
  if (Array.isArray(completion.titleVersions)) {
    listing.title_versions = completion.titleVersions;
    listing.selected_title_index = completion.selectedTitleIndex;
    if (Number.isInteger(completion.selectedTitleIndex) && completion.titleVersions[completion.selectedTitleIndex]) listing.title = completion.titleVersions[completion.selectedTitleIndex];
  }
  if (Array.isArray(completion.secondaryImages)) assets.secondary_images = completion.secondaryImages;
  return { ...job, listing, assets, title: listing.title || job.title, mainImage: assets.main_image || job.mainImage, detailImageCount: Array.isArray(assets.detail_images) ? assets.detail_images.length : job.detailImageCount, packageCompletion: completion };
}
function packageCompletionUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("商品包补充内容必须是对象。");
  const allowed = new Set(["titleVersions", "selectedTitleIndex", "secondaryImages"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`不支持的商品包补充字段：${key}`);
  const titleVersions = Array.isArray(value.titleVersions) ? value.titleVersions.map(item => String(item || "").trim()) : [];
  const secondaryImages = Array.isArray(value.secondaryImages) ? value.secondaryImages.map(item => String(item || "").trim()) : [];
  if (titleVersions.length > 2 || secondaryImages.length > 4) throw new Error("最多保存两个标题版本和四张副图。");
  if ([...titleVersions, ...secondaryImages].some(value => value.length > 1000)) throw new Error("标题或素材路径过长。");
  const selectedTitleIndex = value.selectedTitleIndex === null || value.selectedTitleIndex === undefined || value.selectedTitleIndex === "" ? null : Number(value.selectedTitleIndex);
  if (selectedTitleIndex !== null && (!Number.isInteger(selectedTitleIndex) || selectedTitleIndex < 0 || selectedTitleIndex > 1)) throw new Error("请选择标题版本 1 或 2。");
  return { titleVersions, selectedTitleIndex, secondaryImages, savedAt: new Date().toISOString() };
}
function productPackageValidation(job) {
  const listing = job.listing || {}, assets = job.assets || {}, issues = [], warnings = [];
  const locationType = listing.location_type || job.locationType || "", destination = String(listing.destination || job.destination || "").trim();
  const country = String(listing.country || "").trim(), city = String(listing.city || "").trim();
  const titles = titleVersions(listing, job.title), selectedIndex = listing.selected_title_index;
  const selectedTitle = String(listing.title || job.title || "").trim();
  const secondaryImages = Array.isArray(assets.secondary_images) ? assets.secondary_images.filter(Boolean) : [];
  const detailImages = Array.isArray(assets.detail_images) ? assets.detail_images.filter(Boolean) : [];
  if (!["country", "city"].includes(locationType)) issues.push("地点类型必须为 country 或 city");
  if (!destination) issues.push("缺少目的地");
  if (locationType === "country") {
    if (!country) issues.push("国家级链接缺少 listing.country");
    if (city) issues.push("国家级链接不得填写 listing.city");
    if (country && destination && country !== destination) issues.push("国家级链接的 destination 必须与 country 一致");
  }
  if (locationType === "city") {
    if (!city) issues.push("城市级链接缺少 listing.city");
    if (city && destination && city !== destination) issues.push("城市级链接的 destination 必须与 city 一致");
  }
  if (titles.length !== 2 || new Set(titles).size !== 2) issues.push("必须提供两个不重复的标题版本");
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= titles.length) issues.push("必须用 selected_title_index 人工选择标题版本");
  else if (selectedTitle !== titles[selectedIndex]) issues.push("listing.title 必须与人工选择的标题版本一致");
  if (!selectedTitle) issues.push("缺少当前使用标题");
  else if (destination && !selectedTitle.includes(destination)) issues.push("当前使用标题必须包含目的地");
  if (!String(assets.main_image || job.mainImage || "").trim()) issues.push("缺少主图");
  if (secondaryImages.length !== 4 || new Set(secondaryImages).size !== 4) issues.push("必须提供 4 张不重复的副图");
  if (!detailImages.length) issues.push("缺少固定详情图顺序");
  else if (new Set(detailImages).size !== detailImages.length) issues.push("详情图不得重复");
  issues.push(...imageFileIssues(job, "主图", [assets.main_image || job.mainImage]));
  issues.push(...imageFileIssues(job, "副图", secondaryImages));
  issues.push(...imageFileIssues(job, "详情图", detailImages));
  if (job.titleUnits === null || job.titleUnits === undefined) warnings.push("标题字数仍须按真实类目人工复核");
  return { valid: issues.length === 0, issues, warnings, titleVersionCount: titles.length, secondaryImageCount: secondaryImages.length, detailImageCount: detailImages.length };
}
function mappingCaptureRecords(value) { return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && typeof item.evidence === "string" && typeof item.capturedAt === "string").slice(0, 12).map(item => ({ url: isTaobaoUrl(item.url) ? item.url : "", title: String(item.title || "").slice(0, 180), risk: String(item.risk || "").slice(0, 80), evidence: item.evidence, capturedAt: item.capturedAt })) : []; }
function withReleaseSafety(job) { const reviewEvidence = job.reviewEvidence || job.review_evidence || {}; const automationMapping = job.automationMapping || job.automation_mapping || {}; const mappingCaptures = mappingCaptureRecords(job.mappingCaptures); return { ...job, reviewEvidence, automationMapping, mappingCaptures, packageValidation: productPackageValidation(job), mappingValidation: mappingValidation(automationMapping), releaseBlockers: releaseBlockers(reviewEvidence) }; }
function listingIdentity(job) {
  const listing = job?.listing || {}, locationType = listing.location_type || job?.locationType || "";
  const target = String(locationType === "country" ? listing.country : locationType === "city" ? listing.city : "").trim();
  return ["country", "city"].includes(locationType) && target ? { locationType, target } : null;
}
function belongsToShop(job, shop) {
  const declaredShop = String(job?.profile?.shop_name || "").trim();
  return !declaredShop || declaredShop === shop?.name;
}
function duplicateListingValidation(job, jobs = [], shop) {
  const identity = listingIdentity(job);
  if (!identity || !belongsToShop(job, shop)) return { valid: true, duplicates: [] };
  const duplicates = jobs.filter(candidate => {
    const candidateIdentity = listingIdentity(candidate);
    return candidate.id !== job.id && belongsToShop(candidate, shop) && candidateIdentity?.locationType === identity.locationType && candidateIdentity.target === identity.target;
  }).map(candidate => ({ id: candidate.id, destination: candidate.destination || identity.target, sourceFile: basename(String(candidate.sourceFile || "")) }));
  return { valid: duplicates.length === 0, identity, duplicates };
}
function duplicateListingMessage(job, jobs, shop) {
  const result = duplicateListingValidation(job, jobs, shop);
  if (result.valid) return "";
  const label = result.identity.locationType === "country" ? "国家" : "城市";
  const references = result.duplicates.map(item => item.sourceFile || item.id).join("、");
  return `同店已存在 ${label}级“${result.identity.target}”商品包（${references}）；请人工保留一条并重新导入后再创建任务。`;
}
function auditPreflight(job, jobs, shop) {
  if (!belongsToShop(job, shop)) return { state: "blocked", label: "店铺不匹配", detail: `请切换至 ${job.profile?.shop_name || "商品包所属店铺"} 后处理` };
  if (job.status !== "READY") return { state: "blocked", label: "待确认商品包", detail: `当前状态为 ${job.status || "UNKNOWN"}；填入真实资料、完成页面核验后改为 READY` };
  const duplicate = duplicateListingMessage(job, jobs, shop);
  if (duplicate) return { state: "blocked", label: "同店重复商品", detail: duplicate };
  if (!job.packageValidation?.valid) return { state: "blocked", label: "商品包待修复", detail: (job.packageValidation?.issues || ["请重新导入完整商品包"]).join("、") };
  if (job.releaseBlockers?.length) return { state: "blocked", label: `发布阻塞 ${job.releaseBlockers.length} 项`, detail: job.releaseBlockers.join("、") };
  if (!job.mappingValidation?.valid) return { state: "blocked", label: "字段映射未就绪", detail: (job.mappingValidation?.issues || ["请重新导入包含 automation_mapping 的商品包"]).join("、") };
  return { state: "ready", label: "可创建草稿任务", detail: "已通过商品包、证据与 DRY_RUN 映射检查" };
}
function auditReport(state, shop) {
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const entries = jobs.map(job => {
    const preflight = auditPreflight(job, jobs, shop);
    return { id: job.id, destination: job.destination || "未命名目的地", location_type: job.locationType || job.listing?.location_type || "unknown", package_status: job.status || "UNKNOWN", preflight_state: preflight.state, preflight_label: preflight.label, next_step: preflight.detail, source_file: basename(String(job.sourceFile || "")) };
  });
  const count = label => entries.filter(entry => entry.preflight_label === label).length;
  return {
    generated_at: new Date().toISOString(),
    mode: "REVIEW_AND_DRY_RUN_ONLY",
    shop: { id: shop.id, name: shop.name },
    summary: { total_packages: entries.length, ready_for_dry_run: entries.filter(entry => entry.preflight_state === "ready").length, waiting_for_review: count("待确认商品包"), package_blocked: count("商品包待修复"), duplicate_blocked: count("同店重复商品"), evidence_blocked: entries.filter(entry => entry.preflight_label.startsWith("发布阻塞")).length, mapping_blocked: count("字段映射未就绪"), shop_mismatch: count("店铺不匹配") },
    packages: entries,
    tasks: (state.tasks || []).filter(task => task.shopId === shop.id).map(task => ({ id: task.id, mode: task.mode, state: task.state, current_step: task.currentStep || "", item_count: (task.items || []).length, updated_at: task.updatedAt || "" })),
    note: "本报告仅来自本机工作台状态；不含账号、Cookie、素材绝对路径或淘宝发布结果。"
  };
}
function safeAuditText(value) {
  return String(value || "").replace(/[A-Za-z]:[\\/][^\s，。；、]+/g, "[本机路径]").replace(/https?:\/\/[^\s，。；、]+/gi, "[外部链接]");
}
function safeAuditEvidence(value) {
  const evidence = String(value || "").replace(/\\/g, "/");
  return evidence.startsWith("output/") ? evidence : "";
}
function taskAdmissionSnapshot(job, jobs, shop, checkedAt = new Date().toISOString()) {
  const preflight = auditPreflight(job, jobs, shop);
  return { checkedAt: String(checkedAt), state: String(preflight.state || "unknown"), label: String(preflight.label || "未记录"), detail: String(preflight.detail || "") };
}
function taskAdmissionAudit(snapshot) {
  return {
    checked_at: String(snapshot?.checkedAt || ""),
    state: String(snapshot?.state || "unknown"),
    label: safeAuditText(snapshot?.label),
    detail: safeAuditText(snapshot?.detail)
  };
}
function taskAuditReport(task, shop) {
  const items = Array.isArray(task?.items) ? task.items : [];
  const events = Array.isArray(task?.events) ? task.events : [];
  return {
    generated_at: new Date().toISOString(),
    mode: "DRY_RUN",
    task: {
      id: String(task?.id || ""), state: String(task?.state || "UNKNOWN"), current_step: String(task?.currentStep || ""),
      created_at: String(task?.createdAt || ""), updated_at: String(task?.updatedAt || ""),
      shop: { id: String(shop?.id || task?.shopId || ""), name: String(shop?.name || task?.shopName || "") }
    },
    items: items.map(item => ({
      destination: String(item?.destination || item?.jobId || "未命名商品"), state: String(item?.state || "UNKNOWN"), attempts: Number(item?.attempts || 0),
      completed_fields: Array.isArray(item?.completedFields) ? item.completedFields.map(String) : [], pending_manual_field: String(item?.pendingManualField || ""),
      isolated_reason: safeAuditText(item?.isolatedReason), dry_run_evidence: safeAuditEvidence(item?.dryRunEvidence),
      admission_at_creation: taskAdmissionAudit(item?.admissionSnapshot)
    })),
    events: events.slice(0, 200).map(event => ({ at: String(event?.at || ""), type: String(event?.type || ""), message: safeAuditText(event?.message), evidence: safeAuditEvidence(event?.evidence) })),
    note: "本审计包仅记录本机 DRY_RUN 状态与安全证据引用；不含账号、Cookie、素材绝对路径、字段定位器、发布点击或淘宝发布结果。"
  };
}
function reviewEvidenceUpdate(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("审核证据必须是字段与来源的对应关系。"); const allowed = new Set(releaseEvidenceRules.map(([key]) => key)); const result = {}; for (const [key, source] of Object.entries(value)) { if (!allowed.has(key)) throw new Error(`未知审核字段：${key}`); if (typeof source !== "string") throw new Error(`${key} 的证据来源必须是文本。`); if (source.length > 500) throw new Error(`${key} 的证据来源不能超过 500 个字符。`); result[key] = source.trim(); } return result; }
const terminalTaskStates = new Set(["COMPLETED", "COMPLETED_WITH_ISOLATIONS", "FAILED", "CANCELLED"]);
const queueableTaskStates = new Set(["WAITING_FOR_REVIEW"]);
const isolatablePauseSteps = new Set(["PACKAGE_MISSING", "PACKAGE_REVALIDATION_FAILED", "PACKAGE_CHANGED_SINCE_REVIEW", "PACKAGE_SNAPSHOT_MISSING", "REVIEW_REVALIDATION_FAILED", "SHOP_REVALIDATION_FAILED", "MAPPING_INVALID", "MAPPING_CHANGED_SINCE_REVIEW", "MAPPING_SNAPSHOT_MISSING", "FIELD_VALUE_MISSING", "PAGE_OR_MAPPING_PAUSED", "DUPLICATE_LISTING_DETECTED"]);
function taskItemKey(shopId, job) { return createHash("sha256").update(`${shopId}\u0000${job.id}\u0000${job.sourceFile || ""}`).digest("hex").slice(0, 20); }
function taskEvent(type, message, evidence = "") { return { at: new Date().toISOString(), type, message, ...(evidence ? { evidence } : {}) }; }
function normalizeTask(task) { const items = Array.isArray(task?.items) ? task.items : []; return { ...task, mode: "DRY_RUN", state: task?.state || "WAITING_FOR_REVIEW", currentStep: task?.currentStep || "REVIEW_REQUIRED", items: items.map(item => ({ ...item, state: item.state || "NOT_STARTED" })), events: Array.isArray(task?.events) ? task.events : [] }; }
function activeTaskItemKeys(tasks) { return new Set(tasks.filter(task => !terminalTaskStates.has(task.state)).flatMap(task => task.items.map(item => item.idempotencyKey)).filter(Boolean)); }
function activeTaskForJob(tasks, jobId) { return (tasks || []).find(task => !terminalTaskStates.has(task?.state) && (task.items || []).some(item => item?.jobId === jobId)); }
function assertJobIsMutable(state, job) { const task = activeTaskForJob(state?.tasks, job?.id); if (task) throw new Error(`${job.destination || job.id} 已在未结束任务 ${task.id} 中；请先取消该任务，再修改商品包、审核证据或字段映射。`); }
function createTask(state, shop, jobIds) {
  if (!Array.isArray(jobIds) || !jobIds.length) throw new Error("请至少选择一条可创建草稿任务的商品包。");
  const uniqueIds = [...new Set(jobIds.map(String))];
  if (uniqueIds.length !== jobIds.length) throw new Error("同一商品包不能在一个任务中重复出现。");
  if (uniqueIds.length > 10) throw new Error("DRY_RUN 每批最多 10 条，请分批处理。");
  const selected = uniqueIds.map(id => state.jobs.find(job => job.id === id));
  if (selected.some(job => !job)) throw new Error("所选商品包已不存在，请刷新后重试。");
  for (const job of selected) {
    if (job.status !== "READY") throw new Error(`${job.destination} 未通过文件预检。`);
    if (!job.packageValidation?.valid) throw new Error(`${job.destination} 的商品包待修复：${job.packageValidation?.issues?.join("、") || "请重新导入完整商品包"}`);
    if (job.releaseBlockers?.length) throw new Error(`${job.destination} 仍有发布阻塞，不能创建任务。`);
    const currentMappingValidation = mappingValidation(job.automationMapping);
    if (!currentMappingValidation.valid) throw new Error(`${job.destination} 的字段映射未就绪：${currentMappingValidation.issues.join("、")}`);
    if (job.profile?.shop_name && job.profile.shop_name !== shop.name) throw new Error(`${job.destination} 与当前店铺不匹配。`);
    const duplicateMessage = duplicateListingMessage(job, state.jobs, shop);
    if (duplicateMessage) throw new Error(duplicateMessage);
  }
  const keys = selected.map(job => taskItemKey(shop.id, job));
  const existing = activeTaskItemKeys(state.tasks || []);
  const duplicate = selected.find((job, index) => existing.has(keys[index]));
  if (duplicate) throw new Error(`${duplicate.destination} 已在未结束的 DRY_RUN 任务中；请先在任务中心恢复、取消或等待其结束。`);
  const now = new Date().toISOString();
  const task = {
    id: `dryrun-${randomUUID().slice(0, 8)}`,
    shopId: shop.id,
    shopName: shop.name,
    mode: "DRY_RUN",
    state: "WAITING_FOR_REVIEW",
    createdAt: now,
    updatedAt: now,
    items: selected.map((job, index) => { const mapping = mappingSnapshot(job.automationMapping || {}), packageSnapshot = packageExecutionSnapshot(job), admissionSnapshot = taskAdmissionSnapshot(job, state.jobs, shop, now); return { jobId: job.id, destination: job.destination, state: "NOT_STARTED", idempotencyKey: keys[index], mappingSnapshot: mapping, mappingFingerprint: mappingFingerprint(mapping), packageSnapshot, packageFingerprint: packageExecutionFingerprint(packageSnapshot), admissionSnapshot }; }),
    currentStep: "REVIEW_REQUIRED",
    events: [taskEvent("CREATED", `已创建 ${selected.length} 条 DRY_RUN 草稿任务；尚未打开淘宝页面。`)]
  };
  state.tasks = [task, ...(state.tasks || [])];
  return task;
}
function updateTask(state, id, action, reason = "", evidence = "") {
  const task = (state.tasks || []).find(candidate => candidate.id === id);
  if (!task) throw new Error("任务不存在。");
  if (action === "queue") {
    if (!queueableTaskStates.has(task.state) && !(task.state === "PAUSED" && task.currentStep === "SESSION_REVALIDATION_FAILED")) throw new Error("只有待人工复核或已暂停的任务可以排队。");
    if (task.state === "PAUSED") {
      if (task.currentStep !== "SESSION_REVALIDATION_FAILED") throw new Error("此暂停必须通过对应的人工恢复、复核或取消重建处理，不能直接排队。");
      task.items = task.items.map(item => item.state === "PAUSED" ? { ...item, state: "WAITING_FOR_FORM" } : item);
    }
    task.state = "QUEUED";
    task.currentStep = "READY_TO_OPEN_SELLER";
    task.events.unshift(taskEvent("QUEUED", "已进入 DRY_RUN 队列；尚未调用浏览器。"));
  }
  if (action === "start") {
    if (task.state !== "QUEUED") throw new Error("只有已排队的任务可以开始 DRY_RUN。");
    task.state = "RUNNING";
    task.currentStep = "PRE_EXECUTION_REVIEW";
    task.items = task.items.map(item => item.state === "NOT_STARTED" ? { ...item, state: "WAITING_FOR_FORM" } : item);
    task.events.unshift(taskEvent("DRY_RUN_STARTED", "开始执行前复核；尚未打开卖家页面、填写字段、上传素材或提交。"));
  }
  if (action === "pause") {
    if (terminalTaskStates.has(task.state)) throw new Error("已结束任务不能暂停。");
    task.state = "PAUSED";
    task.currentStep = "PAUSED_RISK_CONTROL";
    task.items = task.items.map(item => ["WAITING_FOR_FORM", "RUNNING"].includes(item.state) ? { ...item, state: "PAUSED" } : item);
    task.events.unshift(taskEvent("PAUSED_RISK_CONTROL", reason || "人工暂停，等待处理。", evidence));
  }
  if (action === "resume") {
    if (task.state !== "PAUSED" || !["PAUSED_RISK_CONTROL", "RISK_PAUSED", "SESSION_REVALIDATION_FAILED"].includes(task.currentStep)) throw new Error("只有完成风控或登录验证后的任务可以恢复；资料或映射问题请修复后取消旧任务并新建 DRY_RUN。 ");
    if (!reason.trim()) throw new Error("请记录已由人工完成的滑块、验证码或登录处理结果后再恢复任务。");
    task.state = "QUEUED";
    task.currentStep = "READY_TO_OPEN_SELLER";
    task.items = task.items.map(item => item.state === "PAUSED" ? { ...item, state: "WAITING_FOR_FORM", attempts: (item.attempts || 0) + 1 } : item);
    task.events.unshift(taskEvent("RESUMED_BY_HUMAN", `已由人工确认完成现场处理：${reason.trim()}。恢复后仅使用重新核验的当前草稿页。`, evidence));
  }
  if (action === "complete-dry-run") {
    if (task.state !== "PAUSED" || task.currentStep !== "FINAL_REVIEW_REQUIRED") throw new Error("只有已填写至提交前、等待人工核验的任务可以完成 DRY_RUN。");
    if (!reason.trim()) throw new Error("请记录本次草稿已人工核验的结论后再完成 DRY_RUN。");
    const item = task.items.find(candidate => candidate.state === "DRAFT_FILLED_WAITING_REVIEW");
    if (!item) throw new Error("未找到等待人工核验的商品草稿。");
    item.state = "DRY_RUN_REVIEWED";
    const remaining = task.items.filter(candidate => !["DRY_RUN_REVIEWED", "CANCELLED"].includes(candidate.state));
    if (remaining.length) {
      task.state = "QUEUED";
      task.currentStep = "NEXT_ITEM_READY";
      task.events.unshift(taskEvent("DRY_RUN_ITEM_REVIEWED", `${item.destination || item.jobId} 已由人工核验。核验结论：${reason.trim()}。剩余 ${remaining.length} 条待处理，需再次开始 DRY_RUN。`, evidence || item.dryRunEvidence));
    } else {
      task.state = "COMPLETED";
      task.currentStep = "DRY_RUN_REVIEWED";
      task.events.unshift(taskEvent("DRY_RUN_REVIEWED", `本批草稿均已由人工核验。最后一条核验结论：${reason.trim()}。任务完成，但未点击发布或提交。`, evidence || item.dryRunEvidence));
    }
  }
  if (action === "acknowledge-manual") {
    if (task.state !== "PAUSED" || task.currentStep !== "MANUAL_FIELD_REQUIRED") throw new Error("当前任务没有等待人工填写的字段。");
    const item = task.items.find(candidate => candidate.state === "PAUSED" && candidate.pendingManualField);
    if (!item) throw new Error("未找到等待人工填写的商品字段。");
    const fieldId = item.pendingManualField;
    item.completedFields = [...new Set([...(item.completedFields || []), fieldId])];
    delete item.pendingManualField;
    item.state = "WAITING_FOR_FORM";
    task.state = "QUEUED";
    task.currentStep = "READY_TO_OPEN_SELLER";
    task.events.unshift(taskEvent("MANUAL_FIELD_ACKNOWLEDGED", `${fieldId} 已由人工确认完成；恢复后将跳过此字段。`));
  }
  if (action === "isolate-item") {
    if (task.state !== "PAUSED" || !isolatablePauseSteps.has(task.currentStep)) throw new Error("当前暂停原因不能隔离。风控、人工填写和提交前核验必须在原流程中完成。");
    if (!reason.trim()) throw new Error("请填写隔离原因，便于后续修复和追溯。");
    const item = task.items.find(candidate => candidate.state === "PAUSED");
    if (!item) throw new Error("未找到可隔离的暂停商品。");
    item.state = "ISOLATED";
    item.isolatedReason = reason.trim();
    item.isolatedAt = new Date().toISOString();
    const remaining = task.items.filter(candidate => !["DRY_RUN_REVIEWED", "CANCELLED", "ISOLATED"].includes(candidate.state));
    if (remaining.length) {
      task.state = "QUEUED";
      task.currentStep = "NEXT_ITEM_READY";
      task.events.unshift(taskEvent("ITEM_ISOLATED", `${item.destination || item.jobId} 已隔离：${reason.trim()}。剩余 ${remaining.length} 条待处理，需再次手动开始 DRY_RUN；隔离操作未打开新的卖家页面。`));
    } else {
      task.state = "COMPLETED_WITH_ISOLATIONS";
      task.currentStep = "BATCH_FINISHED_WITH_ISOLATIONS";
      task.events.unshift(taskEvent("BATCH_FINISHED_WITH_ISOLATIONS", `${item.destination || item.jobId} 已隔离：${reason.trim()}。本批没有可继续处理的商品；隔离操作未提交或发布。`));
    }
  }
  if (action === "cancel") {
    if (terminalTaskStates.has(task.state)) throw new Error("已结束任务不能取消。");
    task.state = "CANCELLED";
    task.currentStep = "CANCELLED";
    task.events.unshift(taskEvent("CANCELLED", "已人工取消；未提交或发布任何商品。"));
  }
  task.updatedAt = new Date().toISOString();
  return task;
}
export { updateTask, mappingValidation, detectPlatformRisk, pageRisk, listingIdentity, duplicateListingValidation, auditPreflight, auditReport, taskAuditReport, taskAdmissionSnapshot, createTask, executeNextDryRun, isTaobaoUrl, mappingCaptureRecords, mergeImportedJobs, mappingSnapshot, mappingFingerprint, mappingSnapshotChanges, packageExecutionSnapshot, packageExecutionFingerprint, packageExecutionSnapshotChanges, activeTaskForJob, assertJobIsMutable, collectReadyPackages };
function toJob(pkg, file) { return withReleaseSafety({ id: packageId(pkg, file), sourceFile: file, importedAt: new Date().toISOString(), destination: pkg.listing?.destination || pkg.listing?.country || "未命名目的地", locationType: pkg.listing?.location_type || "unknown", title: pkg.listing?.title || "", titleUnits: pkg.listing?.title_units ?? null, listing: pkg.listing || {}, assets: pkg.assets || {}, status: pkg.status || "UNKNOWN", mainImage: pkg.assets?.main_image || "", detailImageCount: pkg.assets?.detail_images?.length || 0, profile: pkg.release_profile || {}, checks: pkg.checks || [], result: pkg.result || { state: "not_started" }, runState: "queued", note: "等待人工审核", reviewEvidence: pkg.review_evidence || {}, automationMapping: pkg.automation_mapping || {} }); }
function collectReadyPackages(records) { const jobs = [], skipped = [], errors = []; for (const record of records) { try { const pkg = typeof record.content === "string" ? JSON.parse(record.content) : record.content; if (!pkg?.listing) { skipped.push({ sourceFile: record.sourceFile, reason: "不是商品包 JSON" }); continue; } if (!["READY", "NEEDS_REVIEW"].includes(pkg.status)) { skipped.push({ sourceFile: record.sourceFile, reason: `状态为 ${pkg.status || "UNKNOWN"}，仅接纳 READY 或 NEEDS_REVIEW 商品包` }); continue; } jobs.push(toJob(pkg, record.sourceFile)); } catch { errors.push({ sourceFile: record.sourceFile, reason: "JSON 无法解析" }); } } return { jobs, skipped, errors, acceptedReady: jobs.filter(job => job.status === "READY").length, acceptedNeedsReview: jobs.filter(job => job.status === "NEEDS_REVIEW").length }; }
function mergeImportedJobs(importedJobs, previousJobs, tasks = []) {
  const previous = new Map(previousJobs.map(job => [job.id, job]));
  const imported = importedJobs.map(job => {
    const prior = previous.get(job.id);
    if (!prior) return withReleaseSafety(job);
    job = applyPackageCompletion(job, prior.packageCompletion);
    job.reviewEvidence = { ...(prior.reviewEvidence || {}), ...(job.reviewEvidence || {}) };
    if (!Object.keys(job.automationMapping || {}).length) job.automationMapping = prior.automationMapping || {};
    job.mappingCaptures = prior.mappingCaptures || [];
    return withReleaseSafety(job);
  });
  const importedIds = new Set(imported.map(job => job.id));
  const activeJobIds = new Set((tasks || []).filter(task => !terminalTaskStates.has(task?.state)).flatMap(task => task.items || []).map(item => item?.jobId).filter(Boolean));
  const preservedActiveJobs = previousJobs.filter(job => activeJobIds.has(job.id) && !importedIds.has(job.id)).map(withReleaseSafety);
  return [...imported, ...preservedActiveJobs];
}
async function loadState() { await mkdir(RUNTIME, { recursive: true }); if (!existsSync(STATE_FILE)) return { folder: DEFAULT_FOLDER, jobs: [], tasks: [], activeShopId: defaultShop.id, updatedAt: null }; try { const state = JSON.parse(await readFile(STATE_FILE, "utf8")); return { activeShopId: defaultShop.id, ...state, jobs: (state.jobs || []).map(withReleaseSafety), tasks: (state.tasks || []).map(normalizeTask) }; } catch { return { folder: DEFAULT_FOLDER, jobs: [], tasks: [], activeShopId: defaultShop.id, updatedAt: null }; } }
async function saveState(state) { state.updatedAt = new Date().toISOString(); await writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }
async function loadShops() { await mkdir(RUNTIME, { recursive: true }); if (!existsSync(SHOPS_FILE)) { await writeFile(SHOPS_FILE, JSON.stringify([defaultShop], null, 2)); return [defaultShop]; } try { const shops = JSON.parse(await readFile(SHOPS_FILE, "utf8")); return Array.isArray(shops) && shops.length ? shops.map(shop => ({ ...shop, profileDir: projectProfile(shop.id) })) : [defaultShop]; } catch { return [defaultShop]; } }
async function saveShops(shops) { await writeFile(SHOPS_FILE, JSON.stringify(shops, null, 2)); }
async function exportedPackage(job) {
  if (!isAbsolute(String(job.sourceFile || ""))) throw new Error("原始商品包不在本机目录中，无法导出合并后的 JSON。");
  const source = JSON.parse(await readFile(job.sourceFile, "utf8"));
  if (!source?.listing) throw new Error("原始商品包格式无效，无法导出。");
  const result = { ...source, listing: job.listing, assets: job.assets };
  if (Object.keys(job.reviewEvidence || {}).length) result.review_evidence = job.reviewEvidence;
  if (Object.keys(job.automationMapping || {}).length) result.automation_mapping = job.automationMapping;
  return result;
}
function activeShop(state, shops) { return shops.find(shop => shop.id === state.activeShopId) || shops[0]; }
async function scan(folder) { const entries = await readdir(folder, { withFileTypes: true }); const files = []; for (const entry of entries) { const file = join(folder, entry.name); if (entry.isDirectory()) files.push(...await scan(file)); else if (extname(entry.name).toLowerCase() === ".json") files.push(file); } const records = await Promise.all(files.map(async file => ({ sourceFile: file, content: await readFile(file, "utf8") }))); return collectReadyPackages(records); }
async function connect(shop) { return sessionGuard.connect(shop); }
async function browserStatus(shop) { const persistent = await browserEnvironment.status(shop); const guarded = await sessionGuard.status(shop); return { ...guarded, ...persistent, canExecute: guarded.canExecute && persistent.loggedIn, cdp: cdpUrl(shop), reason: guarded.connected && !guarded.ownershipVerified ? guarded.reason : persistent.reason || guarded.reason }; }
async function captureMappingEvidence(shop) {
  const { pages } = await connect(shop);
  const page = pages.find(candidate => isTaobaoUrl(candidate.url()));
  if (!page) throw new Error("专用 Chrome 中没有已打开的淘宝 HTTPS 页面；请先手动进入需要核验的卖家草稿页。");
  const title = String(await page.title().catch(() => "")).slice(0, 180);
  const risk = await pageRisk(page);
  await mkdir(MAPPING_ARTIFACTS, { recursive: true });
  const file = join(MAPPING_ARTIFACTS, `seller-page-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return { url: page.url(), title, risk, evidence: relative(ROOT, file).replace(/\\/g, "/"), capturedAt: new Date().toISOString() };
}
async function openSeller(shop) { const { browser, pages } = await connect(shop); const page = pages.find(p => p.url().includes("taobao.com")) || pages[0] || await browser.contexts()[0].newPage(); await page.bringToFront(); await page.goto(SELLER_HOME, { waitUntil: "domcontentloaded", timeout: 30000 }); }
function mappingLocator(page, locator = {}) {
  if (locator.strategy === "css") return page.locator(locator.value);
  if (locator.strategy === "label") return page.getByLabel(locator.value, { exact: true });
  if (locator.strategy === "text") return page.getByText(locator.value, { exact: true });
  if (locator.strategy === "testid") return page.getByTestId(locator.value);
  if (locator.strategy === "role" && locator.role) return page.getByRole(locator.role, { name: locator.value, exact: true });
  throw new Error(`不支持的定位方式：${locator.strategy || "未提供"}`);
}
function valueAt(source, job) {
  const defaults = { category: "profile.category_path", title: "listing.title", price: "profile.price_cny", main_images: "assets.main_image", secondary_images: "assets.secondary_images", detail_images: "assets.detail_images", inventory: "profile.inventory" };
  const path = defaults[source] || source || "";
  const fallback = { "listing.title": job.title, "assets.main_image": job.mainImage, "assets.secondary_images": job.assets?.secondary_images || [], "assets.detail_images": job.assets?.detail_images || [], "profile.price_cny": job.profile?.price_cny, "profile.inventory": job.profile?.inventory, "profile.category_path": job.profile?.category_path };
  if (Object.hasOwn(fallback, path) && fallback[path] !== undefined) return fallback[path];
  return path.split(".").filter(Boolean).reduce((value, key) => value?.[key], job);
}
function fieldValue(field, job) { return valueAt(field.source || field.id, job); }
function artifactName(task, suffix) { return join(TASK_ARTIFACTS, task.id, `${String(task.events?.length || 0).padStart(3, "0")}-${suffix}.png`); }
async function captureTask(page, task, suffix) { const path = artifactName(task, suffix); await mkdir(dirname(path), { recursive: true }); await page.screenshot({ path, fullPage: false }); return relative(ROOT, path).replace(/\\/g, "/"); }
function pauseExecution(task, item, type, message, evidence = "") { task.state = "PAUSED"; task.currentStep = type; if (item) item.state = "PAUSED"; task.events.unshift(taskEvent(type, message, evidence)); task.updatedAt = new Date().toISOString(); }
const executingShops = new Set();
async function executeNextDryRun(state, shop, task, guard = sessionGuard) {
  if (executingShops.has(shop.id)) throw new SessionError("此店铺已有执行中的任务，请等待完成或暂停后重试。");
  executingShops.add(shop.id);
  try { return await executeDryRunItem(state, shop, task, guard); }
  finally { executingShops.delete(shop.id); }
}
async function executeDryRunItem(state, shop, task, guard) {
  if (task.shopId !== shop.id || (state.activeShopId && state.activeShopId !== shop.id)) return pauseExecution(task, null, "SESSION_REVALIDATION_FAILED", "任务与当前店铺不一致，未执行字段操作。");
  const item = task.items.find(candidate => candidate.state === "NOT_STARTED") || task.items.find(candidate => candidate.state === "WAITING_FOR_FORM");
  if (!item) { task.state = "PAUSED"; task.currentStep = "FINAL_REVIEW_REQUIRED"; task.events.unshift(taskEvent("FINAL_REVIEW_REQUIRED", "本批 DRY_RUN 已填写至提交前；等待人工逐条核验，不会提交发布。")); return; }
  const job = state.jobs.find(candidate => candidate.id === item.jobId);
  if (!job) return pauseExecution(task, item, "PACKAGE_MISSING", "商品包已不存在，无法继续。");
  if (job.status !== "READY") return pauseExecution(task, item, "PACKAGE_REVALIDATION_FAILED", "商品包已不再通过文件预检，未打开卖家页面。");
  if (!job.packageValidation?.valid) return pauseExecution(task, item, "PACKAGE_REVALIDATION_FAILED", `商品包已发生变化且待修复：${job.packageValidation?.issues?.join("、") || "未知原因"}。未打开卖家页面。`);
  if (job.releaseBlockers?.length) return pauseExecution(task, item, "REVIEW_REVALIDATION_FAILED", `发布审核证据不完整：${job.releaseBlockers.join("、")}。未打开卖家页面。`);
  if (!item.packageSnapshot || !item.packageFingerprint) return pauseExecution(task, item, "PACKAGE_SNAPSHOT_MISSING", "任务创建时未冻结商品包内容；请重新审核后取消旧任务并新建 DRY_RUN。未打开卖家页面。");
  const currentPackageSnapshot = packageExecutionSnapshot(job), currentPackageFingerprint = packageExecutionFingerprint(currentPackageSnapshot);
  if (item.packageFingerprint !== currentPackageFingerprint) { const changes = packageExecutionSnapshotChanges(item.packageSnapshot, currentPackageSnapshot); return pauseExecution(task, item, "PACKAGE_CHANGED_SINCE_REVIEW", `商品包在创建任务后已变化：${changes.join("、") || "商品资料"}。请重新审核后取消旧任务并新建 DRY_RUN。未打开卖家页面。`); }
  if (job.profile?.shop_name && job.profile.shop_name !== shop.name) return pauseExecution(task, item, "SHOP_REVALIDATION_FAILED", `商品包属于“${job.profile.shop_name}”，当前店铺为“${shop.name}”。未打开卖家页面。`);
  const duplicateMessage = duplicateListingMessage(job, state.jobs, shop);
  if (duplicateMessage) return pauseExecution(task, item, "DUPLICATE_LISTING_DETECTED", `${duplicateMessage}未打开卖家页面。`);
  const mapping = job.automationMapping || {};
  const currentMappingValidation = mappingValidation(mapping);
  if (!currentMappingValidation.valid) return pauseExecution(task, item, "MAPPING_INVALID", `字段映射未就绪：${currentMappingValidation.issues.join("、")}`);
  if (!item.mappingSnapshot || !item.mappingFingerprint) return pauseExecution(task, item, "MAPPING_SNAPSHOT_MISSING", "任务创建时未冻结字段映射；请核验当前映射后取消旧任务并重新创建 DRY_RUN。未打开卖家页面。");
  const currentMappingSnapshot = mappingSnapshot(mapping), currentMappingFingerprint = mappingFingerprint(currentMappingSnapshot);
  if (item.mappingFingerprint !== currentMappingFingerprint) { const changes = mappingSnapshotChanges(item.mappingSnapshot, currentMappingSnapshot); return pauseExecution(task, item, "MAPPING_CHANGED_SINCE_REVIEW", `字段映射在创建任务后已变化：${changes.join("、") || "映射内容"}。请重新核验后取消旧任务并新建 DRY_RUN。未打开卖家页面。`); }
  let page;
  try {
    page = await guard.assertExecute(shop, mapping.draft_url);
    await page.bringToFront();
    await guard.assertExecute(shop, mapping.draft_url);
    task.currentStep = "DRAFT_FORM_OPENED";
    task.events.unshift(taskEvent("SELLER_DRAFT_OPENED", "已复核当前卖家草稿页及店铺身份；开始 DRY_RUN，不会提交或发布。"));
    const initialShot = await captureTask(page, task, "draft-opened");
    const risk = await pageRisk(page);
    if (risk) { guard.invalidateAll("检测到平台风控，请人工处理并重新核验身份。"); return pauseExecution(task, item, "PAUSED_RISK_CONTROL", `检测到“${risk}”，请在专用 Chrome 手动处理后恢复任务。`, initialShot); }
    for (const field of mapping.fields) {
      await guard.assertExecute(shop, mapping.draft_url);
      if ((item.completedFields || []).includes(field.id)) continue;
      const value = fieldValue(field, job);
      if (field.interaction === "manual") { item.pendingManualField = field.id; return pauseExecution(task, item, "MANUAL_FIELD_REQUIRED", `${field.id} 被映射为人工填写；完成后点击“确认已人工填写”。`, initialShot); }
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        if (field.required !== false) return pauseExecution(task, item, "FIELD_VALUE_MISSING", `${field.id} 缺少商品包来源值，未继续填写。`, initialShot);
        continue;
      }
      const target = mappingLocator(page, field.locator);
      await target.waitFor({ state: "visible", timeout: 10000 });
      await guard.assertExecute(shop, mapping.draft_url);
      if (field.interaction === "fill") await target.fill(String(value));
      if (field.interaction === "select") await target.selectOption(String(value));
      if (field.interaction === "upload") await target.setInputFiles(Array.isArray(value) ? value : [value]);
      // The action has resolved. Persist it before checking for a newly surfaced risk so a human recovery never replays a successful upload.
      item.completedFields = [...new Set([...(item.completedFields || []), field.id])];
      const fieldShot = await captureTask(page, task, `field-${field.id}`);
      const fieldRisk = await pageRisk(page);
      if (fieldRisk) { guard.invalidateAll("检测到平台风控，请人工处理并重新核验身份。"); return pauseExecution(task, item, "PAUSED_RISK_CONTROL", `填写“${field.id}”后检测到“${fieldRisk}”，请在专用 Chrome 手动处理后恢复任务。`, fieldShot); }
      task.events.unshift(taskEvent("FIELD_FILLED", `${field.id} 已按已验证映射完成 DRY_RUN 填写。`, fieldShot));
    }
    const finalRisk = await pageRisk(page);
    if (finalRisk) {
      guard.invalidateAll("检测到平台风控，请人工处理并重新核验身份。");
      const finalRiskShot = await captureTask(page, task, "risk-before-review");
      return pauseExecution(task, item, "PAUSED_RISK_CONTROL", `填写完成后检测到“${finalRisk}”，请在专用 Chrome 手动处理后恢复任务。`, finalRiskShot);
    }
    await guard.assertExecute(shop, mapping.draft_url);
    item.state = "DRAFT_FILLED_WAITING_REVIEW";
    item.dryRunEvidence = await captureTask(page, task, "ready-for-review");
    await guard.assertExecute(shop, mapping.draft_url);
    task.state = "PAUSED";
    task.currentStep = "FINAL_REVIEW_REQUIRED";
    task.events.unshift(taskEvent("FINAL_REVIEW_REQUIRED", "已填写至最终提交前，等待人工检查页面；执行器不会点击发布或提交。", item.dryRunEvidence));
  } catch (error) {
    let evidence = "";
    try { if (page) evidence = await captureTask(page, task, "execution-paused"); } catch { /* Screenshot failure should not hide the original cause. */ }
    pauseExecution(task, item, error.riskDetected ? "PAUSED_RISK_CONTROL" : error.code === "SESSION_REVALIDATION_FAILED" ? error.code : "PAGE_OR_MAPPING_PAUSED", `字段执行已暂停：${error.message.split("\n")[0]}`, evidence);
  }
}
export async function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SessionError("调试端口配置无效，请修复店铺配置。");
  await new Promise((accept, reject) => { const probe = createNetServer(); probe.once("error", () => reject(new SessionError("调试端口已占用或不可用，归属未知；请人工关闭旧专用窗口后重试。"))); probe.listen(port, "127.0.0.1", () => probe.close(accept)); });
}
export function nextShopPort(shops) { const used = new Set(shops.map(shop => Number(shop.port))); let port = 9222; while (used.has(port) && port < 65535) port++; if (used.has(port)) throw new ClientInputError("没有可分配的调试端口。"); return port; }
async function launchChrome(shop) { const executable = chromePath(); if (!executable) throw new Error("未找到 Google Chrome，请安装后重试。"); return browserEnvironment.start(shop, executable); }
const serveFile = createStaticHandler(ROOT);
async function context() { const state = await loadState(), shops = await loadShops(); return { state, shops, shop: activeShop(state, shops) }; }

let mutationBusy = false;
export const workbenchServer = createServer(async (req, res) => {
  let holdsMutation = false;
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (!network.allowed(req)) return json(res,403,{error:'仅允许本机或指定内部局域网访问'});
    if (!url.pathname.startsWith("/api/")) return await serveFile(req, res);
    if (req.method === 'POST' && !network.originAllowed(req.headers.origin)) return json(res,403,{error:'仅允许本机或指定局域网工作台发起操作'});
    // Pausing cannot be discarded behind a slow product status/configuration request.
    if(req.method==='POST'&&url.pathname==='/api/v1/pause'){req.resume();return json(res,200,(await product()).pause());}
    if (req.method === 'POST' && (sourceWorkflow?.active||batchWorkflow?.active) && !/^\/api\/os\/(quotes\/|preparations\/|shops\/add$)/.test(url.pathname) && !['/api/source/pause','/api/batch/pause','/api/v1/pause','/api/v1/check','/api/v1/recovery-check','/api/program/shutdown'].includes(url.pathname)) return json(res,409,{error:'商品执行中，请先暂停任务'});
    if (req.method === "POST") {
      if (mutationBusy) {
        const stopRequested = /^\/api\/tasks\/[^/]+\/(pause|cancel)$/.test(url.pathname);
        if (stopRequested) sessionGuard.invalidateAll("已收到暂停请求，当前动作完成后停止；请稍后重试保存暂停或取消。");
        return json(res, 409, { error: stopRequested ? "暂停/取消请求已使会话核验失效；当前动作完成后停止，请等待操作结束后重试保存。" : "工作台正在处理其他操作，请等待当前操作结束后重试。" });
      }
      mutationBusy = true; holdsMutation = true;
    }
    if(req.method==='POST'&&executionRoute(url.pathname))await (await product()).assertExecution();
    if(url.pathname.startsWith('/api/os/'))return await travelOs().handle(req,res,url,{body,json});
    if(url.pathname.startsWith('/api/v1/')){
      if(req.method==='POST'&&['start','continue','retry','resume-single','create'].includes(url.pathname.slice(8))&&travelOs().store.removed((await product()).shop.id))return json(res,409,{error:'执行店铺已从管理中移除，禁止创建或启动任务'});
      return await (await product()).handle(req,res,url,{body,json});
    }
    if (req.method === "GET" && url.pathname === "/api/browser/status") { const { shop } = await context(); return json(res, 200, { shop: { id: shop.id, name: shop.name, port: shop.port }, browser: await browserEnvironment.status(shop) }); }
    if(url.pathname.startsWith('/api/batch/')) {
      const flow=batches(), {shop}=await context();
      if(req.method==='GET'&&url.pathname==='/api/batch/state')return json(res,200,flow.state(url.searchParams.get('id')));
      if(req.method==='GET'&&url.pathname==='/api/batch/preview')return json(res,200,flow.preview(url.searchParams.get('import'),Number(url.searchParams.get('limit')||20)));
      if(req.method==='GET'&&url.pathname==='/api/batch/report')return json(res,200,await flow.report(url.searchParams.get('id')));
      if(req.method==='POST'){
        const input=await body(req);
        if(['start','continue','retry'].some(a=>url.pathname==='/api/batch/'+a)&&(await loadState()).tasks?.some(t=>t.state==='RUNNING'))return json(res,409,{error:'旧版任务正在运行，请先暂停'});
        if(url.pathname==='/api/batch/import')return json(res,200,await flow.import(input));
        if(url.pathname==='/api/batch/create')return json(res,201,flow.create(input,shop));
        if(url.pathname==='/api/batch/start'||url.pathname==='/api/batch/continue')return json(res,202,flow.start(input.id,shop));
        if(url.pathname==='/api/batch/pause')return json(res,200,flow.pause());
        if(url.pathname==='/api/batch/retry')return json(res,202,flow.retry(input.id,shop));
        if(url.pathname==='/api/batch/skip')return json(res,200,flow.skip(input.id,input.taskId,input.reason));
      }
      return json(res,404,{error:'未知批量操作'});
    }
    if (url.pathname.startsWith('/api/source/')) {
      const flow=sources(), {shop}=await context();
      if(req.method==='GET' && url.pathname==='/api/source/state')return json(res,200,flow.state());
      if(req.method==='GET' && url.pathname==='/api/source/preview')return json(res,200,flow.preview(url.searchParams.get('batch'),url.searchParams.get('order')));
      if(req.method==='GET' && url.pathname==='/api/source/events')return json(res,200,{events:flow.store.events(url.searchParams.get('id'))});
      if(req.method==='GET' && url.pathname==='/api/source/asset') {const a=await flow.asset(url);res.writeHead(200,{'content-type':a.type,'cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(a.data);}
      if(req.method==='POST') {
        const input=await body(req);
        if(['/api/source/start','/api/source/resume','/api/source/import'].includes(url.pathname)&&batches().store.batch()&&['READY','RUNNING','PAUSED','WAITING_HUMAN'].includes(batches().store.batch().state))return json(res,409,{error:'请使用批量视图操作当前批次'});
        if(url.pathname==='/api/source/import')return json(res,200,await flow.import(input));
        if(url.pathname==='/api/source/upload')return json(res,200,await flow.stage(input));
        if(['/api/source/start','/api/source/resume'].includes(url.pathname) && (await loadState()).tasks?.some(t=>t.state==='RUNNING'))return json(res,409,{error:'旧版任务正在执行，请先暂停，避免两个任务同时操作浏览器'});
        if(url.pathname==='/api/source/start')return json(res,202,await flow.start(input,shop));
        if(url.pathname==='/api/source/resume')return json(res,202,await flow.resume(input,shop));
        if(url.pathname==='/api/source/pause')return json(res,200,flow.pause());
      }
      return json(res,404,{error:'未知商品包操作'});
    }
    if (req.method === "POST" && url.pathname === "/api/program/shutdown") { json(res, 200, { stopping: true }); setImmediate(() => shutdownProgram()); return; }
    if (req.method === "POST" && url.pathname === "/api/chrome/close") { const { shop } = await context(); sessionGuard.invalidateAll("专用浏览器已关闭，任务保持断点。"); await browserEnvironment.close(shop); return json(res, 200, { browser: await browserEnvironment.status(shop) }); }
    if (req.method === "GET" && url.pathname === "/api/status") { const { state, shops, shop } = await context(); return json(res, 200, { state, shops, activeShop: shop, browser: await browserStatus(shop), defaultFolder: DEFAULT_FOLDER, chromeInstalled: !!chromePath() }); }
    if (req.method === "GET" && url.pathname === "/api/reports/preflight") { const { state, shop } = await context(); const stamp = new Date().toISOString().slice(0, 10); return downloadJson(res, `travel-listing-preflight-${stamp}.json`, auditReport(state, shop)); }
    if (req.method === "GET" && /^\/api\/tasks\/[^/]+\/export-audit$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { state, shop } = await context(); const task = (state.tasks || []).find(candidate => candidate.id === id); if (!task) return json(res, 404, { error: "任务不存在。" }); if (task.shopId !== shop.id) return json(res, 409, { error: "请切换至任务所属店铺后再导出审计包。" }); const stamp = new Date().toISOString().slice(0, 10); return downloadJson(res, `travel-listing-task-${task.id}-audit-${stamp}.json`, taskAuditReport(task, shop)); }
    if (req.method === "GET" && /^\/api\/jobs\/[^/]+\/export-package$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { state } = await context(); const job = state.jobs.find(candidate => candidate.id === id); if (!job) return json(res, 404, { error: "商品包不存在。" }); if (!job.packageCompletion) return json(res, 409, { error: "该商品没有本机补齐记录，无需导出。" }); try { const payload = await exportedPackage(job); const filename = `${String(job.destination || "商品包").replace(/[\\/:*?\"<>|]/g, "_")}-补齐后商品包.json`; return downloadJson(res, filename, payload); } catch (error) { return json(res, 409, { error: error.message }); } }
    if (req.method === "POST" && url.pathname === "/api/shops") { const { name, loginHint = "" } = await body(req); if (!String(name).trim()) return json(res, 400, { error: "请输入店铺名称。" }); const { shops } = await context(); const id = `shop-${randomUUID().slice(0, 8)}`; const shop = { id, name: String(name).trim(), loginHint: String(loginHint).trim(), port: nextShopPort(shops), profileDir: projectProfile(id), createdAt: new Date().toISOString() }; shops.push(shop); await saveShops(shops); return json(res, 201, { shops, shop }); }
    if (req.method === "POST" && url.pathname === "/api/shops/select") { const { shopId } = await body(req); const { state, shops } = await context(); if (!shops.some(shop => shop.id === shopId)) return json(res, 404, { error: "店铺不存在。" }); sessionGuard.invalidateAll("已切换店铺，请重新核验身份。"); state.activeShopId = shopId; sessionGuard.select(shops.find(shop => shop.id === shopId)); await saveState(state); return json(res, 200, { state, activeShop: activeShop(state, shops), browser: await browserStatus(activeShop(state, shops)) }); }
    if (req.method === "POST" && url.pathname === "/api/chrome/launch") { const { shop } = await context(); const existing = await browserStatus(shop); if (existing.connected && !existing.ownershipVerified) return json(res, 409, { error: existing.reason, browser: existing }); if (existing.ownershipVerified && !existing.running) return json(res, 409, { error: "检测到旧专用浏览器，请先关闭旧项目窗口；不会接管其他浏览器。" }); if (existing.running) { await browserEnvironment.focus(shop); return json(res, 200, { launch: null, alreadyRunning: true, shop, browser: existing }); } const launch = await launchChrome(shop); return json(res, 200, { launch, shop, browser: await browserStatus(shop) }); }
    if (req.method === "POST" && url.pathname === "/api/chrome/confirm-identity") { const input = await body(req); const { shop } = await context(); const browser = await sessionGuard.confirm(shop, input); return json(res, 200, { ok: true, browser: { ...browser, cdp: cdpUrl(shop) } }); }
    if (req.method === "POST" && url.pathname === "/api/chrome/open-seller") { const { shop } = await context(); await openSeller(shop); return json(res, 200, { ok: true, browser: await browserStatus(shop) }); }
    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/capture-mapping-evidence$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { state, shop } = await context(); const job = state.jobs.find(candidate => candidate.id === id); if (!job) return json(res, 404, { error: "商品包不存在。" }); if (job.profile?.shop_name && job.profile.shop_name !== shop.name) return json(res, 409, { error: `商品包属于“${job.profile.shop_name}”，请先切换至对应店铺再采集页面证据。` }); const browser = await browserStatus(shop); if (!browser.connected) return json(res, 409, { error: "专用 Chrome 未连接；请先启动并人工登录，再打开需要核验的卖家草稿页。" }); try { const capture = await captureMappingEvidence(shop); job.mappingCaptures = mappingCaptureRecords([capture, ...(job.mappingCaptures || [])]); job.mappingCaptureUpdatedAt = capture.capturedAt; await saveState(state); return json(res, 200, { state, job, capture }); } catch (error) { return json(res, 409, { error: error.message }); } }
    if (req.method === "POST" && url.pathname === "/api/jobs/import") { const { folderPath } = await body(req); const folder = resolve(folderPath || DEFAULT_FOLDER); if (!existsSync(folder) || !(await stat(folder)).isDirectory()) return json(res, 400, { error: "商品包文件夹不存在。请检查路径后重试。" }); const { state } = await context(); const result = await scan(folder); state.folder = folder; state.jobs = mergeImportedJobs(result.jobs, state.jobs, state.tasks); state.lastImport = { at: new Date().toISOString(), source: "folder", selected: result.jobs.length + result.skipped.length + result.errors.length, accepted: result.jobs.length, acceptedReady: result.acceptedReady, acceptedNeedsReview: result.acceptedNeedsReview, skipped: result.skipped, errors: result.errors }; await saveState(state); return json(res, 200, { state }); }
    if (req.method === "POST" && url.pathname === "/api/jobs/import-files") { const { packages = [] } = await body(req); if (!Array.isArray(packages) || !packages.length) return json(res, 400, { error: "请选择至少一个 JSON 商品包。" }); if (packages.length > 300) return json(res, 400, { error: "单次最多导入 300 个商品包，请分批导入。" }); const { state } = await context(); const result = collectReadyPackages(packages); state.jobs = mergeImportedJobs(result.jobs, state.jobs, state.tasks); state.lastImport = { at: new Date().toISOString(), source: "upload", selected: packages.length, accepted: result.jobs.length, acceptedReady: result.acceptedReady, acceptedNeedsReview: result.acceptedNeedsReview, skipped: result.skipped, errors: result.errors }; await saveState(state); return json(res, 200, { state }); }
    if (req.method === "POST" && url.pathname === "/api/jobs/import-bundle") { const { packages = [], assets = [] } = await body(req); const staged = await stageUploadedBundle(packages, assets); const { state } = await context(); const result = collectReadyPackages(staged.records); state.folder = staged.root; state.jobs = mergeImportedJobs(result.jobs, state.jobs, state.tasks); state.lastImport = { at: new Date().toISOString(), source: "upload_bundle", selected: packages.length, accepted: result.jobs.length, acceptedReady: result.acceptedReady, acceptedNeedsReview: result.acceptedNeedsReview, skipped: result.skipped, errors: result.errors, assetsStaged: staged.assetsStaged, assetBytes: staged.assetBytes }; await saveState(state); return json(res, 200, { state }); }
    if (req.method === "POST" && url.pathname === "/api/tasks") { const { jobIds, mode = "DRY_RUN" } = await body(req); if (mode !== "DRY_RUN") return json(res, 400, { error: "当前工作台只允许创建 DRY_RUN 草稿任务。" }); const { state, shop } = await context(); let task; try { task = createTask(state, shop, jobIds); } catch (error) { return json(res, 409, { error: error.message }); } await saveState(state); return json(res, 201, { state, task }); }
    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/(queue|start|pause|resume|acknowledge-manual|complete-dry-run|isolate-item|cancel)$/.test(url.pathname)) { const [, id, action] = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(queue|start|pause|resume|acknowledge-manual|complete-dry-run|isolate-item|cancel)$/); const { reason = "", evidence = "" } = await body(req); if (typeof reason !== "string" || reason.length > 300 || typeof evidence !== "string" || evidence.length > 500) return json(res, 400, { error: "原因最多 300 字，截图或证据位置最多 500 字。" }); const { state, shop } = await context(); const task = state.tasks.find(candidate => candidate.id === decodeURIComponent(id)); if (!task) return json(res, 404, { error: "任务不存在。" }); if (task.shopId !== shop.id) return json(res, 409, { error: "请切换至任务所属店铺后再操作。" }); if ((action === "queue" && task.state === "PAUSED") || ["start", "resume", "acknowledge-manual", "complete-dry-run"].includes(action)) { const pending = task.items.find(item => ["PAUSED", "DRAFT_FILLED_WAITING_REVIEW", "WAITING_FOR_FORM", "NOT_STARTED"].includes(item.state)); const target = state.jobs.find(job => job.id === pending?.jobId); if (!target?.automationMapping?.draft_url) throw new SessionError("没有可核验的任务草稿页，请检查任务。"); if (!(await browserEnvironment.status(shop)).loggedIn) throw new SessionError("请先完成人工登录或验证，再恢复当前任务。"); await sessionGuard.assertExecute(shop, target.automationMapping.draft_url); } if (action === "start") { if (task.state !== "QUEUED") return json(res, 409, { error: "只有已排队的任务可以开始 DRY_RUN。" }); const browser = await browserStatus(shop); if (!browser.connected) return json(res, 409, { error: "专用 Chrome 未连接；请先启动并在店铺浏览器中完成人工登录。" }); } if (["pause", "cancel"].includes(action)) sessionGuard.invalidateAll("任务已暂停或取消，请重新核验身份。"); let updated; try { updated = updateTask(state, decodeURIComponent(id), action, reason.trim(), evidence.trim()); if (action === "start") await executeNextDryRun(state, shop, updated); } catch (error) { return json(res, 409, { error: error.message }); } await saveState(state); return json(res, 200, { state, task: updated }); }
    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/automation-mapping$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { automationMapping } = await body(req); let mapping; try { mapping = mappingUpdate(automationMapping); } catch (error) { return json(res, 400, { error: error.message }); } const { state } = await context(); const index = state.jobs.findIndex(job => job.id === id); if (index < 0) return json(res, 404, { error: "商品包不存在。" }); const job = state.jobs[index]; try { assertJobIsMutable(state, job); } catch (error) { return json(res, 409, { error: error.message }); } job.automationMapping = mapping; Object.assign(job, withReleaseSafety(job)); job.reviewedAt = new Date().toISOString(); state.jobs[index] = job; await saveState(state); return json(res, 200, { state, job }); }
    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/package-completion$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { packageCompletion, reset = false } = await body(req); if (typeof reset !== "boolean") return json(res, 400, { error: "reset 必须为布尔值。" }); let completion; try { completion = reset ? null : packageCompletionUpdate(packageCompletion); } catch (error) { return json(res, 400, { error: error.message }); } const { state } = await context(); const index = state.jobs.findIndex(job => job.id === id); if (index < 0) return json(res, 404, { error: "商品包不存在。" }); const current = state.jobs[index]; try { assertJobIsMutable(state, current); } catch (error) { return json(res, 409, { error: error.message }); } const job = completion ? applyPackageCompletion(current, completion) : { ...current, packageCompletion: null }; if (reset) { const source = await readFile(current.sourceFile, "utf8").then(JSON.parse).catch(() => null); if (!source?.listing) return json(res, 409, { error: "无法读取原始商品包，不能重置本地补充内容。" }); Object.assign(job, toJob(source, current.sourceFile), { reviewEvidence: current.reviewEvidence, automationMapping: current.automationMapping, packageCompletion: null }); } Object.assign(job, withReleaseSafety(job)); job.runState = job.releaseBlockers.length || !job.packageValidation.valid ? "waiting_for_review" : "ready_for_dry_run"; job.note = !job.packageValidation.valid ? `商品包待修复：${job.packageValidation.issues.join("、")}` : job.releaseBlockers.length ? `仍缺少 ${job.releaseBlockers.length} 项发布证据` : "证据已齐全，待创建 DRY_RUN 草稿任务"; job.reviewedAt = new Date().toISOString(); state.jobs[index] = job; await saveState(state); return json(res, 200, { state, job }); }
    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/review-evidence$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { reviewEvidence } = await body(req); let update; try { update = reviewEvidenceUpdate(reviewEvidence); } catch (error) { return json(res, 400, { error: error.message }); } const { state } = await context(); const index = state.jobs.findIndex(x => x.id === id); if (index < 0) return json(res, 404, { error: "商品包不存在。" }); const job = state.jobs[index]; try { assertJobIsMutable(state, job); } catch (error) { return json(res, 409, { error: error.message }); } job.reviewEvidence = { ...(job.reviewEvidence || {}), ...update }; Object.assign(job, withReleaseSafety(job)); job.runState = job.releaseBlockers.length || !job.packageValidation.valid ? "waiting_for_review" : "ready_for_dry_run"; job.note = !job.packageValidation.valid ? `商品包待修复：${job.packageValidation.issues.join("、")}` : job.releaseBlockers.length ? `仍缺少 ${job.releaseBlockers.length} 项发布证据` : "证据已齐全，待创建 DRY_RUN 草稿任务"; job.reviewedAt = new Date().toISOString(); state.jobs[index] = job; await saveState(state); return json(res, 200, { state, job }); }
    if (req.method === "POST" && /^\/api\/jobs\/[^/]+\/open-seller$/.test(url.pathname)) { const id = decodeURIComponent(url.pathname.split("/")[3]); const { state, shop } = await context(); const job = state.jobs.find(x => x.id === id); if (!job) return json(res, 404, { error: "商品包不存在。" }); if (job.status !== "READY") return json(res, 409, { error: "此商品包未通过文件预检。" }); if (!job.packageValidation?.valid) return json(res, 409, { error: `商品包待修复：${job.packageValidation?.issues?.join("、") || "请重新导入完整商品包"}` }); if (job.releaseBlockers?.length) return json(res, 409, { error: `发布阻塞：${job.releaseBlockers.join("、")}。请在“审核资料”中补充可追溯证据。` }); if (!job.mappingValidation?.valid) return json(res, 409, { error: `字段映射未就绪：${job.mappingValidation?.issues?.join("、") || "请重新导入包含 automation_mapping 的商品包"}` }); if (job.profile?.shop_name && job.profile.shop_name !== shop.name) return json(res, 409, { error: `商品包属于“${job.profile.shop_name}”，当前选择的是“${shop.name}”。` }); const duplicateMessage = duplicateListingMessage(job, state.jobs, shop); if (duplicateMessage) return json(res, 409, { error: duplicateMessage }); await openSeller(shop); job.runState = "waiting_for_form"; job.note = `上架页已在 ${shop.name} 的专用 Chrome 打开`; await saveState(state); return json(res, 200, { state }); }
    return json(res, 404, { error: "Unknown API" });
  } catch (error) { return json(res, error.statusCode || 500, { error: /^\/api\/(v1|os)\//.test(req.url) ? redact(error.message||String(error)) : error.message || String(error) }); }
  finally { if (holdsMutation) mutationBusy = false; }
});
if (process.env.WORKBENCH_NO_LISTEN !== "1") workbenchServer.listen(PORT, network.bind, async () => { console.log(`旅行上架工作台：http://127.0.0.1:${PORT}${process.env.WORKBENCH_LAN_ADDRESS ? ' 局域网：http://'+process.env.WORKBENCH_LAN_ADDRESS+':'+PORT : ''}`); try { const { shop } = await context(); await launchChrome(shop); } catch { console.error("专用 Chrome 未启动，请在工作台查看浏览器状态后重试。"); } });

let stopping = false;
async function shutdownProgram() {
  if (stopping) return; stopping = true;
  sessionGuard.invalidateAll("程序关闭，任务停留在断点。");
  if(batchWorkflow)await batchWorkflow.shutdown();
  if(sourceWorkflow)await sourceWorkflow.shutdown();
  const state = await loadState();
  for (const task of state.tasks || []) if (task.state === 'RUNNING') {
    task.state = 'PAUSED'; task.currentStep = 'SESSION_REVALIDATION_FAILED';
    task.events.unshift(taskEvent('PROGRAM_CLOSED', '程序关闭，保留已完成字段，重启后重新核验页面。'));
  }
  await saveState(state);
  await browserEnvironment.closeAll();
  if(productApi)(await productApi).closeStreams();
  workbenchServer.close(() => { if (process.env.WORKBENCH_NO_LISTEN !== '1') process.exit(0); });
}
if (process.env.WORKBENCH_NO_LISTEN !== "1") {
  process.on("SIGINT", shutdownProgram); process.on("SIGTERM", shutdownProgram);
}
