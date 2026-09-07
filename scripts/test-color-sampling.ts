// Standalone verification script — NOT part of the app. Exercises
// sampleColorRegion against a real screenshot to confirm the sampling logic
// (crop → bucket pixels → mode → hex) produces a color that actually matches
// what's in the image, without needing a live model call. Writes a small
// swatch PNG of the sampled color next to a crop of the source region so the
// two can be compared by eye.
// Run with: npx tsx scripts/test-color-sampling.ts [path-to-image]
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { sampleColorRegion } from "../lib/colorSampling";

const SOURCE_IMAGE =
  process.argv[2] || path.join(__dirname, "../docs/sample-images/icici-statement-sample.png");
const OUT_DIR = path.join(__dirname, "../.tmp/color-sampling-test");

// A patch of solid orange background in the bundled sample screenshot, in
// the gap between the "Password example" pill and the two account cards —
// clear of any text, icons, or card edges.
const HEADER_BG_BOX: [number, number, number, number] = [285, 445, 310, 495];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const originalImage = fs.readFileSync(SOURCE_IMAGE);

  const hex = await sampleColorRegion(originalImage, HEADER_BG_BOX);
  console.log("[1/2] sampleColorRegion OK, sampled color:", hex);

  // Write the sampled region crop and a solid swatch of the resulting hex
  // side by side (via a tiny generated HTML-free composite) so they can be
  // visually compared.
  const metadata = await sharp(originalImage).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const [ymin, xmin, ymax, xmax] = HEADER_BG_BOX;
  const left = Math.round((xmin / 1000) * width);
  const top = Math.round((ymin / 1000) * height);
  const cropWidth = Math.round(((xmax - xmin) / 1000) * width);
  const cropHeight = Math.round(((ymax - ymin) / 1000) * height);

  const sourceCrop = await sharp(originalImage)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
  fs.writeFileSync(`${OUT_DIR}/source-region.png`, sourceCrop);

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const swatch = await sharp({
    create: { width: cropWidth, height: cropHeight, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(`${OUT_DIR}/sampled-swatch.png`, swatch);

  const composite = await sharp({
    create: { width: cropWidth * 2 + 10, height: cropHeight, channels: 3, background: "#ffffff" },
  })
    .composite([
      { input: sourceCrop, left: 0, top: 0 },
      { input: swatch, left: cropWidth + 10, top: 0 },
    ])
    .png()
    .toBuffer();
  fs.writeFileSync(`${OUT_DIR}/side-by-side.png`, composite);
  console.log(
    "[2/2] wrote side-by-side.png (left: real source pixels, right: sampled hex swatch) — should look identical"
  );
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
