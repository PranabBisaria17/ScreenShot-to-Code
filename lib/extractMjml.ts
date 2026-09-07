/**
 * Pulls the MJML document out of a model response that should contain a single
 * ```mjml ... ``` fenced code block. Falls back to looking for a bare <mjml> tag
 * in case the model forgets the fence, and throws a descriptive error otherwise
 * so the API route can surface something actionable instead of a blank screen.
 */
export function extractMjml(raw: string): string {
  // Try a fence explicitly tagged ```mjml first — the response may also contain
  // a separate ```json fence (image region bounding boxes), and we don't want
  // a non-greedy generic fence match to accidentally grab that one instead.
  const tagged = raw.match(/```mjml\s*([\s\S]*?)```/i);
  if (tagged && tagged[1].trim().startsWith("<mjml")) {
    return tagged[1].trim();
  }

  const fenced = raw.match(/```(?:mjml)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1].trim().startsWith("<mjml")) {
    return fenced[1].trim();
  }

  const bare = raw.match(/<mjml[\s\S]*<\/mjml>/i);
  if (bare) {
    return bare[0].trim();
  }

  throw new Error(
    "Could not find an <mjml> document in the model's response. Raw response started with: " +
      raw.slice(0, 200)
  );
}
