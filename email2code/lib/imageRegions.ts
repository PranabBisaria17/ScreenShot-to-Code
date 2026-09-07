import sharp from "sharp";

export interface ImageRegion {
  id: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax], normalized 0-1000
  description?: string;
}

/**
 * Pulls the optional ```json { "images": [...] } ``` fence out of the model's
 * response. Returns an empty array if there's no such fence — that's the
 * normal case for a design with no real photos worth extracting, not an error.
 */
export function extractImageRegions(raw: string): ImageRegion[] {
  const match = raw.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    // Malformed JSON from the model shouldn't take down the whole conversion —
    // the MJML (already extracted separately) still has its placehold.co
    // fallback for any src the model marked with __IMAGE__:id.
    return [];
  }

  const images = (parsed as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];

  const regions: ImageRegion[] = [];
  for (const item of images) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as ImageRegion).id === "string" &&
      Array.isArray((item as ImageRegion).box_2d) &&
      (item as ImageRegion).box_2d.length === 4 &&
      (item as ImageRegion).box_2d.every((n) => typeof n === "number")
    ) {
      regions.push(item as ImageRegion);
    }
  }
  return regions;
}

/**
 * Crops one region out of the original uploaded screenshot and returns a PNG
 * buffer. box_2d is normalized 0-1000 per Gemini's object-detection convention
 * ([ymin, xmin, ymax, xmax]) — descaled here against the image's real
 * dimensions. Coordinates are clamped and validated defensively since they
 * come from a model, not a trusted source: a malformed or degenerate box
 * (zero-area, out of range) throws so the caller can fall back to a
 * placeholder instead of shipping a broken crop.
 */
export async function cropImageRegion(
  originalImage: Buffer,
  box2d: [number, number, number, number]
): Promise<Buffer> {
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

  if (cropWidth < 4 || cropHeight < 4) {
    throw new Error("Detected image region is too small or degenerate to crop.");
  }

  return image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
}

/**
 * Source for the placeholder src pattern the prompt asks the model to use
 * (e.g. src="__IMAGE__:hero"). Exposed as a source string rather than a
 * shared RegExp instance — callers construct their own `new RegExp(SRC, "g")`
 * so independent replace/matchAll passes never fight over one object's
 * internal lastIndex state.
 */
export const IMAGE_PLACEHOLDER_SOURCE = "__IMAGE__:([a-zA-Z0-9_-]+)";
