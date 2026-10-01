import fs from "node:fs/promises";
import path from "node:path";

const usage = "Usage: node tools/build_new_image_release.mjs --source <package-dir> --output <package-dir> --secondary-dir <new-secondary-image-dir>";
const argv = process.argv.slice(2);
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
};
const sourceDir = value("--source");
const outputDir = value("--output");
const secondaryDir = value("--secondary-dir");
if (!sourceDir || !outputDir || !secondaryDir) throw new Error(usage);

const pngSize = async (file) => {
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(24);
    await handle.read(bytes, 0, 24, 0);
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  } finally {
    await handle.close();
  }
};
const exists = async (file) => fs.access(file).then(() => true).catch(() => false);
const jsonFiles = (await fs.readdir(sourceDir)).filter((file) => file.endsWith(".json") && file !== "manifest.json").sort();
const secondary = (await fs.readdir(secondaryDir))
  .filter((file) => /\.(png|jpe?g)$/i.test(file))
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
  .map((file) => path.join(secondaryDir, file));
if (secondary.length !== 4) throw new Error(`Expected exactly 4 secondary images, found ${secondary.length}: ${secondaryDir}`);
const secondaryValid = await Promise.all(secondary.map(async (file) => {
  const dimensions = await pngSize(file);
  return { file, dimensions, passed: Boolean(dimensions?.[0] === dimensions?.[1]) };
}));
if (secondaryValid.some((item) => !item.passed)) throw new Error("Every secondary image must be a readable square PNG.");

await fs.mkdir(outputDir, { recursive: true });
const summary = [];
for (const file of jsonFiles) {
  const sourcePath = path.join(sourceDir, file);
  const pkg = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const main = pkg.assets?.main_image;
  const detailImages = pkg.assets?.detail_images || [];
  const mainDimensions = main && await exists(main) ? await pngSize(main) : null;
  const mainPassed = Boolean(mainDimensions?.[0] === mainDimensions?.[1] && pkg.assets?.main_image_candidate_count === 1);
  const detailsPassed = detailImages.length === 9 && await Promise.all(detailImages.map(exists)).then((checks) => checks.every(Boolean));
  const sourceReady = pkg.status === "READY";
  const releaseReady = sourceReady && mainPassed && detailsPassed;
  pkg.assets = {
    ...pkg.assets,
    secondary_image_set: {
      source: secondaryDir,
      files: secondary,
      expected_count: 4,
      dimensions: secondaryValid.map((item) => item.dimensions),
    },
  };
  pkg.checks = [
    ...(pkg.checks || []),
    { name: "new desktop secondary set", passed: secondaryValid.every((item) => item.passed), detail: secondary.map((item) => path.basename(item)).join(" → ") },
    { name: "main image exact and square", passed: mainPassed, detail: mainPassed ? `${path.basename(main)} · ${mainDimensions.join("x")}` : "Missing, ambiguous, or non-square main image" },
    { name: "fixed detail set present", passed: detailsPassed, detail: detailsPassed ? "9 files" : `Expected 9 accessible detail images, got ${detailImages.length}` },
  ];
  pkg.status = releaseReady ? "READY" : "NEEDS_REVIEW";
  pkg.release_validation = {
    mode: "FILE_PRECHECK_ONLY",
    asset_source: "desktop-new-set",
    validated_at: new Date().toISOString(),
    note: "READY means file mapping passed only; it is not platform publication approval.",
  };
  await fs.writeFile(path.join(outputDir, file), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  summary.push({ file, row: pkg.source?.row, destination: pkg.listing?.destination, status: pkg.status, reason: releaseReady ? "new image set mapped" : "source review or image validation failed" });
}
const ready = summary.filter((item) => item.status === "READY");
const review = summary.filter((item) => item.status !== "READY");
await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), source_dir: sourceDir, secondary_set: secondary, packages: summary }, null, 2)}\n`, "utf8");
const report = ["# New-image release preflight", "", `- Packages: ${summary.length}`, `- READY: ${ready.length}`, `- NEEDS_REVIEW: ${review.length}`, `- Secondary set: ${secondary.map((file) => `\`${path.basename(file)}\``).join(" → ")}`, "", "## Needs review", "", "| Row | Destination | Reason |", "|---:|---|---|"];
report.push(...(review.length ? review.map((item) => `| ${item.row} | ${item.destination} | ${item.reason} |`) : ["| - | - | - |"]));
await fs.writeFile(path.join(outputDir, "preflight-report.md"), `${report.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ packages: summary.length, ready: ready.length, needsReview: review.length, secondary: secondary.map((file) => path.basename(file)) }));
