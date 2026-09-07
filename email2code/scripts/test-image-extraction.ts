// Standalone verification script — NOT part of the app. Simulates a model
// response (since this doesn't call the live Gemini/Anthropic APIs) to
// exercise extractMjml + extractImageRegions + cropImageRegion end to end
// against a real screenshot, and writes the result so it can be visually
// checked. Run with: npx tsx scripts/test-image-extraction.ts [path-to-image]
//
// Note: docs/sample-images/icici-statement-sample.png is a real bank email
// screenshot used only as a local test fixture (to have something with a
// real logo to crop). If you ever make this repo public, swap it for a
// synthetic mock instead — no need to ship a real bank's branding.
import fs from "fs";
import path from "path";
import mjml2html from "mjml";
import { extractMjml } from "../lib/extractMjml";
import { extractImageRegions, cropImageRegion, IMAGE_PLACEHOLDER_SOURCE } from "../lib/imageRegions";

const SOURCE_IMAGE =
  process.argv[2] || path.join(__dirname, "../docs/sample-images/icici-statement-sample.png");
const OUT_DIR = path.join(__dirname, "../.tmp/image-extraction-test");

// A plausible fake model response: MJML that marks the bank logo as a real
// image to extract, plus the json fence with its bounding box. Coordinates
// estimated from the actual screenshot (1206x1038, logo in the top header).
const FAKE_MODEL_RESPONSE = `\`\`\`mjml
<mjml>
  <mj-body background-color="#eeeeee">
    <mj-section background-color="#992a15" padding="20px">
      <mj-column width="100%">
        <mj-image src="__IMAGE__:logo" alt="ICICI Bank" align="center" width="300px" />
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="20px">
      <mj-column width="100%">
        <mj-text align="center">Test body content below the extracted logo.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
\`\`\`

\`\`\`json
{"images": [{"id": "logo", "box_2d": [30, 220, 110, 650], "description": "ICICI Bank logo"}]}
\`\`\`
`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const originalImage = fs.readFileSync(SOURCE_IMAGE);

  // 1. Parse exactly like the API route does.
  const mjmlSource = extractMjml(FAKE_MODEL_RESPONSE);
  console.log("[1/5] extractMjml OK, starts with:", mjmlSource.slice(0, 30));

  const regions = extractImageRegions(FAKE_MODEL_RESPONSE);
  console.log("[2/5] extractImageRegions OK:", JSON.stringify(regions));
  if (regions.length !== 1 || regions[0].id !== "logo") {
    throw new Error("Expected exactly one region with id 'logo'");
  }

  // 2. Crop the real logo out of the original screenshot.
  const cropped = await cropImageRegion(originalImage, regions[0].box_2d);
  fs.writeFileSync(`${OUT_DIR}/cropped-logo.png`, cropped);
  console.log("[3/5] cropImageRegion OK, wrote cropped-logo.png,", cropped.length, "bytes");

  // 3. Build the preview MJML (data URI inlined) the way the route does.
  const dataUri = `data:image/png;base64,${cropped.toString("base64")}`;
  const previewMjml = mjmlSource.replace(new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"), () => dataUri);
  const exportMjml = mjmlSource.replace(
    new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"),
    () => "images/logo.png"
  );

  if (previewMjml.includes("__IMAGE__")) throw new Error("Placeholder was not replaced in preview MJML");
  if (!exportMjml.includes("images/logo.png")) throw new Error("Export MJML missing expected filename");
  console.log("[4/5] placeholder substitution OK for both preview and export MJML");

  // 4. Compile the preview version and render it so the crop can be checked visually.
  const compiled = await mjml2html(previewMjml, { validationLevel: "soft" });
  if (compiled.errors.length > 0) {
    console.warn("MJML compile warnings:", compiled.errors);
  }
  fs.writeFileSync(`${OUT_DIR}/preview.html`, compiled.html);
  console.log("[5/5] compiled preview.html, errors:", compiled.errors.length);
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
