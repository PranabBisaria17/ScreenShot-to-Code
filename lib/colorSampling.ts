import sharp from "sharp";

export interface ColorRegion {
  id: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax], normalized 0-1000
  description?: string;
}

/**
 * Pulls the optional { "colors": [...] } array out of the SAME ```json fence
 * used for image regions (lib/imageRegions.ts parses the "images" key from
 * that same fence — there is only ever one json fence per response). Returns
 * an empty array if there's none, which is normal when the model used plain
 * hex guesses throughout.
 */
export function extractColorRegions(raw: string): ColorRegion[] {
  const match = raw.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return [];
  }

  const colors = (parsed as { colors?: unknown }).colors;
  if (!Array.isArray(colors)) return [];

  const regions: ColorRegion[] = [];
  for (const item of colors) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as ColorRegion).id === "string" &&
      Array.isArray((item as ColorRegion).box_2d) &&
      (item as ColorRegion).box_2d.length === 4 &&
      (item as ColorRegion).box_2d.every((n) => typeof n === "number")
    ) {
      regions.push(item as ColorRegion);
    }
  }
  return regions;
}

/**
 * Samples the dominant color inside a region of the ORIGINAL screenshot and
 * returns it as a hex string. Rather than trusting a single pixel (which can
 * land on an anti-aliased edge, JPEG compression noise, or a stray text
 * stroke), this reads every pixel in the box, buckets them into
 * near-identical shades, and returns the average color of the largest
 * bucket — i.e. the most common color in the sampled area. This is why the
 * prompt asks the model for a box over a solid patch rather than a single
 * point: a mode over a mostly-solid box is robust to a bit of noise at the
 * edges, whereas a single point is not.
 */
export async function sampleColorRegion(
  originalImage: Buffer,
  box2d: [number, number, number, number]
): Promise<string> {
  const image = sharp(originalImage);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("Could not read source image dimensions.");
  }

  const [yminRaw, xminRaw, ymaxRaw, xmaxRaw] = box2d;
  const clamp01000 = (n: number) => Math.max(0, Math.min(1000, n));
  const ymin = clamp01000(yminRaw);
  const xmin = clamp01000(xminRaw);
  const ymax = clamp01000(ymaxRaw);
  const xmax = clamp01000(xmaxRaw);

  const left = Math.round((xmin / 1000) * width);
  const top = Math.round((ymin / 1000) * height);
  const right = Math.round((xmax / 1000) * width);
  const bottom = Math.round((ymax / 1000) * height);
  const cropWidth = right - left;
  const cropHeight = bottom - top;

  if (cropWidth < 1 || cropHeight < 1) {
    throw new Error("Detected color region is too small or degenerate to sample.");
  }

  const { data, info } = await image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const BUCKET = 12; // quantization step — merges near-identical shades so noise doesn't split the mode.
  const buckets = new Map<string, { count: number; rSum: number; gSum: number; bSum: number }>();

  for (let i = 0; i + channels <= data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 16) continue; // skip near-transparent pixels
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${Math.round(r / BUCKET)}_${Math.round(g / BUCKET)}_${Math.round(b / BUCKET)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.rSum += r;
      bucket.gSum += g;
      bucket.bSum += b;
    } else {
      buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  let winner: { count: number; rSum: number; gSum: number; bSum: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.count > winner.count) winner = bucket;
  }
  if (!winner) {
    throw new Error("No sampleable pixels in the requested color region.");
  }

  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const r = toHex(winner.rSum / winner.count);
  const g = toHex(winner.gSum / winner.count);
  const b = toHex(winner.bSum / winner.count);
  return `#${r}${g}${b}`;
}

/**
 * Source for the placeholder value pattern the prompt asks the model to use
 * (e.g. background-color="__COLOR__:header_bg"). A source string, not a
 * shared RegExp instance, for the same reason as IMAGE_PLACEHOLDER_SOURCE —
 * independent replace/matchAll passes shouldn't share one RegExp's lastIndex.
 */
export const COLOR_PLACEHOLDER_SOURCE = "__COLOR__:([a-zA-Z0-9_-]+)";
