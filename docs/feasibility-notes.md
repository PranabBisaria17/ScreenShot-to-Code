# Feasibility test notes

Before building this app, we ran a quick spike to answer one question: can a
Claude-class vision model reliably turn an email screenshot into valid,
reasonably faithful MJML?

## Method

1. Hand-built a realistic marketing email in MJML (header, hero image,
   headline, body copy, CTA button, two-column feature block, footer with
   links) — `source_screenshot.png` below.
2. Rendered it to a screenshot.
3. With no access to the original MJML source — only the screenshot — wrote a
   reconstruction of the MJML purely from what was visible in the image.
4. Compiled the reconstruction with the `mjml` compiler and rendered it —
   `reconstructed_screenshot.png` below.

## Results

- **Zero MJML compile errors or warnings** on the reconstruction. The AI's job
  is only to describe structure/content/color in MJML tags; the compiler
  guarantees the output is valid, Outlook-safe, table-based HTML. This is the
  core reason this niche is more tractable than generic screenshot-to-code:
  the "will this render in Outlook" problem is handled by a mature compiler,
  not by the model.
- **Layout structure, copy, and section ordering matched exactly.**
- **Colors and spacing were close but not pixel-perfect** — off by a shade of
  hex value and a small amount of vertical spacing. This is the expected gap:
  the model is estimating colors visually rather than sampling actual pixel
  values. A follow-up worth building: extract dominant colors from the
  uploaded image programmatically (e.g., with a color-quantization library)
  and pass them to the model as hints, rather than relying on its visual
  guess alone.

## Caveat

This test used one clean, professionally-composed template. Real-world
screenshots — messier layouts, product grids, text overlaid on images,
hand-drawn mockups — will stress this more and should be tested before
treating the conversion quality as "solved."

Images: `feasibility-test/source_screenshot.png` (input) and
`feasibility-test/reconstructed_screenshot.png` (blind reconstruction, output).
