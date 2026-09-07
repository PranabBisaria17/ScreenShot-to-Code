import { NextRequest, NextResponse } from "next/server";
import mjml2html from "mjml";
import { extractMjml } from "@/lib/extractMjml";
import { convertWithGemini } from "@/lib/ai/gemini";
import { convertWithAnthropic } from "@/lib/ai/anthropic";
import { extractImageRegions, cropImageRegion, IMAGE_PLACEHOLDER_SOURCE } from "@/lib/imageRegions";
import { extractColorRegions, sampleColorRegion, COLOR_PLACEHOLDER_SOURCE } from "@/lib/colorSampling";

export const runtime = "nodejs";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — keep uploads small; resize on the client if needed.

// Gemini is the default: it has a genuinely free tier (no card required), so
// the whole pipeline can be tried at zero cost. Set AI_PROVIDER=anthropic in
// .env.local to switch once you want production-grade quality — see
// docs/feasibility-notes.md for how that was validated.
type Provider = "gemini" | "anthropic";

function getProvider(): Provider {
  const raw = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  return raw === "anthropic" ? "anthropic" : "gemini";
}

interface ResolvedImage {
  id: string;
  filename: string;
  dataUri: string;
}

export async function POST(req: NextRequest) {
  const provider = getProvider();
  const requiredKeyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  if (!process.env[requiredKeyName]) {
    return NextResponse.json(
      {
        error: `${requiredKeyName} is not set on the server (AI_PROVIDER=${provider}). Add it to .env.local and restart the dev server.`,
      },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with an 'image' field." },
      { status: 400 }
    );
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image file provided." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type '${file.type}'. Use PNG, JPEG, or WebP.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Image is too large (${Math.round(file.size / 1024 / 1024)}MB). Max is 8MB.` },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");

  let rawText: string;
  try {
    rawText =
      provider === "anthropic"
        ? await convertWithAnthropic(base64, file.type)
        : await convertWithGemini(base64, file.type);
  } catch (err) {
    const message = err instanceof Error ? err.message : `Unknown error calling ${provider}.`;
    return NextResponse.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }

  let mjmlSource: string;
  try {
    mjmlSource = extractMjml(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract MJML.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const warnings: string[] = [];

  // --- Exact color sampling ---
  // The model marks any color it wants pixel-accurate with a placeholder
  // like background-color="__COLOR__:<id>" and (optionally) supplies a
  // bounding box over a solid patch of that color for each id, in the same
  // ```json fence used for image regions. We sample the ACTUAL pixel color
  // there from the ORIGINAL screenshot (lib/colorSampling.ts) instead of
  // trusting the model's guessed hex — the same "use the real pixels, don't
  // let the model reinterpret them" idea as image extraction, applied to
  // color. This resolves directly into mjmlSource: unlike images, a color
  // doesn't need a separate preview/export version.
  const referencedColorIds = new Set<string>();
  for (const m of mjmlSource.matchAll(new RegExp(COLOR_PLACEHOLDER_SOURCE, "g"))) {
    referencedColorIds.add(m[1]);
  }

  if (referencedColorIds.size > 0) {
    const colorRegions = extractColorRegions(rawText);
    const colorRegionById = new Map(colorRegions.map((r) => [r.id, r]));
    const resolvedColorById = new Map<string, string>();

    for (const id of referencedColorIds) {
      const region = colorRegionById.get(id);
      if (!region) {
        warnings.push(`No sample region was returned for color "${id}" — used a neutral gray placeholder instead.`);
        resolvedColorById.set(id, "#999999");
        continue;
      }
      try {
        resolvedColorById.set(id, await sampleColorRegion(bytes, region.box_2d));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown color sampling error.";
        warnings.push(`Couldn't sample color "${id}" (${message}) — used a neutral gray placeholder instead.`);
        resolvedColorById.set(id, "#999999");
      }
    }

    mjmlSource = mjmlSource.replace(
      new RegExp(COLOR_PLACEHOLDER_SOURCE, "g"),
      (_match, id: string) => resolvedColorById.get(id) ?? "#999999"
    );
  }

  // --- Real image extraction ---
  // The model marks any real photo/illustration worth preserving with
  // src="__IMAGE__:<id>" and (optionally) supplies bounding boxes for those
  // ids in a separate ```json fence. We crop those regions out of the
  // ORIGINAL uploaded screenshot (not a re-generated image) so what ships is
  // actual pixels from the design, not an AI reinterpretation of it.
  const referencedIds = new Set<string>();
  for (const m of mjmlSource.matchAll(new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"))) {
    referencedIds.add(m[1]);
  }

  const resolvedImages: ResolvedImage[] = [];
  const fallbackForId = new Map<string, string>();

  if (referencedIds.size > 0) {
    const regions = extractImageRegions(rawText);
    const regionById = new Map(regions.map((r) => [r.id, r]));

    for (const id of referencedIds) {
      const region = regionById.get(id);
      if (!region) {
        warnings.push(
          `No bounding box was returned for "${id}" — used a placeholder instead.`
        );
        fallbackForId.set(id, "https://placehold.co/400x300?text=Replace+with+your+image");
        continue;
      }
      try {
        const cropped = await cropImageRegion(bytes, region.box_2d);
        const dataUri = `data:image/png;base64,${cropped.toString("base64")}`;
        resolvedImages.push({ id, filename: `images/${id}.png`, dataUri });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown cropping error.";
        warnings.push(`Couldn't extract "${id}" (${message}) — used a placeholder instead.`);
        fallbackForId.set(id, "https://placehold.co/400x300?text=Replace+with+your+image");
      }
    }
  }

  const resolvedById = new Map(resolvedImages.map((img) => [img.id, img]));

  // Preview version: real images inlined as data URIs so the live iframe
  // actually shows what was detected. Fine for an in-app preview; NOT what
  // should ship in production email HTML (see exportMjml below).
  const previewMjml = mjmlSource.replace(
    new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"),
    (_match, id: string) => resolvedById.get(id)?.dataUri ?? fallbackForId.get(id) ?? _match
  );

  // Export version: relative filenames instead of inlined base64. Outlook
  // desktop and several other clients handle base64 inline images poorly or
  // not at all, so shipping data URIs in the code you'd actually paste into
  // an ESP would quietly undermine the whole "Outlook-safe" point of this
  // tool. The matching PNGs are returned in `images` for you to host and
  // point these filenames at.
  const exportMjml = mjmlSource.replace(
    new RegExp(IMAGE_PLACEHOLDER_SOURCE, "g"),
    (_match, id: string) => resolvedById.get(id)?.filename ?? fallbackForId.get(id) ?? _match
  );

  // Note: mjml2html is async in this version of the mjml package (a change
  // from older versions where it returned synchronously) — must be awaited.
  const [previewCompiled, exportCompiled] = await Promise.all([
    mjml2html(previewMjml, { validationLevel: "soft" }),
    mjml2html(exportMjml, { validationLevel: "soft" }),
  ]);

  if (exportCompiled.errors.length > 0) {
    // Non-fatal in "soft" mode — MJML still produces best-effort HTML. Surface
    // the warnings so the UI can show them instead of hiding silent issues.
    console.warn("MJML compile warnings:", exportCompiled.errors);
  }

  return NextResponse.json({
    mjml: exportMjml,
    html: exportCompiled.html,
    previewHtml: previewCompiled.html,
    images: resolvedImages,
    warnings: [...exportCompiled.errors.map((e) => e.formattedMessage), ...warnings],
  });
}
