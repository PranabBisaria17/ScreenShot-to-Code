// Standalone verification script — NOT part of the app. Replays the FULL
// route.ts pipeline (color resolution, then image extraction, then preview
// vs. export MJML, then mjml2html) against a fake model response that uses
// BOTH __COLOR__ and __IMAGE__ placeholders together, against a real
// screenshot. This is the integration check that scripts/test-image-extraction.ts
// and scripts/test-color-sampling.ts don't cover individually: it confirms
// the two features don't interfere with each other (e.g. one placeholder
// regex accidentally matching the other, or resolution order mattering).
// Run with: npx tsx scripts/test-full-pipeline.ts [path-to-image]
import fs from "fs";
import path from "path";
import mjml2html from "mjml";
import { extractMjml } from "../lib/extractMjml";
import { extractImageRegions, cropImageRegion, IMAGE_PLACEHOLDER_SOURCE } from "../lib/imageRegions";
import { extractColorRegions, sampleColorRegion, COLOR_PLACEHOLDER_SOURCE } from "../lib/colorSampling";

const SOURCE_IMAGE =
  process.argv[2] || path.join(__dirname, "../docs/sample-images/icici-statement-sample.png");
const OUT_DIR = path.join(__dirname, "../.tmp/full-pipeline-test");

const FAKE_MODEL_RESPONSE = `\`\`\`mjml
<mjml>
  <mj-body background-color="#eeeeee">
    <mj-section background-color="__COLOR__:banner_bg" padding="20px">
      <mj-column width="100%">
        <mj-image src="__IMAGE__:logo" alt="ICICI Bank" align="center" width="300px" />
        <mj-text align="center" color="#ffffff">Open your e-statement</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column width="100%">
        <mj-button background-color="__COLOR__:banner_bg" color="#ffffff">Same brand color as the banner</mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
\`\`\`

\`\`\`json
{"images": [{"id": "logo", "box_2d": [30, 220, 110, 650], "description": "ICICI Bank logo"}], "colors": [{"id": "banner_bg", "box_2d": [285, 445, 310, 495], "description": "orange banner background"}]}
\`\`\`
`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const originalImage = fs.readFileSync(SOURCE_IMAGE);

  let mjmlSource = extractMjml(FAKE_MODEL_RESPONSE);
  console.log("[1/6] extractMjml OK");

  // --- Color resolution (mirrors app/api/convert/route.ts) ---
  const referencedColorIds = new Set<string>();
  for (const m of mjmlSource.matchAll(new RegExp(COLOR_PLACEHOLDER_SOURCE, "g"))) {
    referencedColorIds.add(m[1]);
  }
  if (referencedColorIds.size !== 1 || !referencedColorIds.has("banner_bg")) {
    throw new Error(`Expected exactly one color id "banner_bg", got: ${[...referencedColorIds]}`);
  }
  console.log("[2/6] found referenced color ids:", [...referencedColorIds]);

  const colorRegions = extractColorRegions(FAKE_MODEL_RESPONSE);
  const colorRegionById = new Map(colorRegions.map((r) => [r.id, r]));
  const resolvedColorById = new Map<string, string>();
  for (const id of referencedColorIds) {
    const region = colorRegionById.get(id);
    if (!region) throw new Error(`No region for color id ${id}`);
    resolvedColorById.set(id, await sampleColorRegion(originalImage, region.box_2d));
  }
  mjmlSource = mjmlSource.replace(
    new RegExp(COLOR_PLACEHOLDER_SOURCE, "g"),
    (_match, id: string) => resolvedColorById.get(id) ?? "#999999"
  );
  if (mjmlSource.includes("__COLOR__")) throw new Error("Color placeholder was not fully replaced");
  const sampledHex = resolvedColorById.get("banner_bg")!;
  console.log("[3/6] color resolved, banner_bg ->", sampledHex, "(used in 2 places in the MJML)");
  const occurrences = mjmlSource.split(sampledHex).length - 1;
  if (occurrences < 2) {
    throw new Error(`Expected the same sampled color to appear at least twice, found ${occurrences}`);
  }

  // --- Image resolution (mirrors route.ts) ---
  const referencedImageIds = new Set<string>();
  for (const m of mjmlSource.matchAll(new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"))) {
    referencedImageIds.add(m[1]);
  }
  if (referencedImageIds.size !== 1 || !referencedImageIds.has("logo")) {
    throw new Error(`Expected exactly one image id "logo", got: ${[...referencedImageIds]}`);
  }
  const imageRegions = extractImageRegions(FAKE_MODEL_RESPONSE);
  const region = imageRegions.find((r) => r.id === "logo")!;
  const cropped = await cropImageRegion(originalImage, region.box_2d);
  const dataUri = `data:image/png;base64,${cropped.toString("base64")}`;
  console.log("[4/6] image cropped OK,", cropped.length, "bytes");

  const previewMjml = mjmlSource.replace(new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"), () => dataUri);
  const exportMjml = mjmlSource.replace(new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"), () => "images/logo.png");
  if (previewMjml.includes("__IMAGE__") || previewMjml.includes("__COLOR__")) {
    throw new Error("Preview MJML still has unresolved placeholders");
  }
  if (!exportMjml.includes("images/logo.png") || exportMjml.includes("__COLOR__")) {
    throw new Error("Export MJML missing expected filename or still has color placeholders");
  }
  console.log("[5/6] both placeholder kinds fully resolved in preview and export MJML");

  const compiled = await mjml2html(previewMjml, { validationLevel: "soft" });
  fs.writeFileSync(`${OUT_DIR}/preview.html`, compiled.html);
  console.log("[6/6] compiled preview.html, MJML compile errors:", compiled.errors.length);
  if (compiled.errors.length > 0) console.warn(compiled.errors);
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
