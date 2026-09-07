# Email Screenshot → MJML

MVP for converting a screenshot of an email design into editable, Outlook-safe
MJML and compiled HTML. Upload a screenshot → a vision model reads it and
writes MJML → the `mjml` compiler turns that into production HTML → you get a
live preview plus copyable/downloadable code.

Supports two AI providers, switchable with one env var:

- **Gemini (default)** — Google's free tier, no card required. Good for
  trying the whole pipeline at zero cost.
- **Anthropic** — Claude, paid per request (a few cents per conversion). This
  is what the feasibility test in `docs/feasibility-notes.md` validated, so
  it's the one to switch to if you want to match that quality bar exactly.

## Why MJML instead of raw HTML

Email HTML has to survive ancient rendering engines (Outlook's Word-based one
being the worst offender), which normally means hand-written table layouts and
inline styles. MJML sidesteps this: the AI only needs to describe the design
in MJML's simpler tags (`<mj-section>`, `<mj-column>`, `<mj-button>`, etc.),
and the mature open-source MJML compiler guarantees valid, Outlook-safe output.
This was validated in a feasibility test before building this app — see
`docs/feasibility-notes.md`.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Then get a **free** Gemini API key at https://aistudio.google.com/apikey (no
payment method required) and paste it into `.env.local` as `GEMINI_API_KEY`.
Leave `AI_PROVIDER=gemini` as-is.

```bash
npm run dev
```

Open http://localhost:3000, upload a PNG/JPEG/WebP screenshot of an email
design, and click **Convert to MJML**.

To switch to Anthropic later: set `AI_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` in `.env.local` (get a key at
https://console.anthropic.com/settings/keys — this one is pay-as-you-go,
roughly $0.01–0.03 per conversion at Claude Sonnet pricing).

## How it works

- `app/page.tsx` — upload UI, live preview (iframe), and MJML/HTML code panels
  with copy/download.
- `app/api/convert/route.ts` — receives the uploaded image, picks a provider
  based on `AI_PROVIDER`, and calls it.
- `lib/ai/gemini.ts` and `lib/ai/anthropic.ts` — one function each, same
  signature, so swapping providers is a one-line env var change rather than a
  code change. Both use the shared prompt in `lib/prompt.ts`.
- The provider's raw response is parsed for MJML (`lib/extractMjml.ts`) and
  compiled to HTML with `mjml`.
- **Real images, not just placeholders.** For real photos/illustrations (not
  logos or icons), the model marks them `src="__IMAGE__:<id>"` in the MJML and
  returns a bounding box for each id (`lib/imageRegions.ts` parses this).
  Those boxes are used to crop the ACTUAL pixels out of your original
  uploaded screenshot with `sharp` — so what you get is real image content,
  not an AI reinterpretation of it. Two versions of the HTML/MJML are built:
  a preview version with the crops inlined as data URIs (for the live iframe
  only), and an export version that references them as `images/<id>.png`
  (what you actually copy/download). This split exists because Outlook
  desktop and several other clients handle base64 inline images poorly —
  shipping data URIs in production email code would quietly undermine the
  Outlook-safety this whole tool is built around. The cropped PNGs are shown
  in the UI with individual download buttons so you can host them and point
  the filenames at your host.
- No database, no auth, no billing — this is a single-request tool by design,
  intentionally minimal so you can validate the idea before investing in that
  infrastructure.

### Verifying the image-extraction pipeline without spending an API call

`scripts/test-image-extraction.ts` feeds a hand-built fake model response
(MJML + a bounding box) through the real `extractMjml` / `extractImageRegions`
/ `cropImageRegion` functions against a real screenshot, so you can confirm
the parsing-and-cropping mechanics work without touching Gemini or Anthropic.
Run it with `npx tsx scripts/test-image-extraction.ts`. It does NOT test
whether the model reliably returns *good* bounding boxes for real designs —
only a live conversion tells you that (see the limitation below).

## Known limitations (MVP scope, not bugs)

- **The feasibility test used Anthropic, not Gemini.** The layout/color/copy
  fidelity notes in `docs/feasibility-notes.md` were measured with Claude.
  Gemini's flash model is a reasonable free substitute for trying the app, but
  its output quality on this specific task hasn't been separately verified —
  compare a few conversions against real designs before trusting it as your
  final quality bar.
- **Real photos are cropped from your screenshot; logos/icons still use
  placeholders (by design).** This works by asking the model for a bounding
  box, then cropping those exact pixels server-side — the mechanics of that
  (parsing, cropping, wiring into preview vs. export HTML) are verified by
  `scripts/test-image-extraction.ts` against a real screenshot. What's NOT
  yet verified is how reliably the model returns *good* bounding boxes across
  varied real designs — that only shows up when you run real conversions. If
  a photo comes out oddly cropped or a placeholder shows up where you
  expected a real image, that's the model's box_2d estimate being off, not a
  bug in the cropping code — worth flagging back so the prompt can be
  tightened, the same way the Outlook-safety rules were.
- **Color/spacing are close, not pixel-perfect.** In testing, layout structure
  and copy came through correctly on the first pass; colors and spacing were
  very close but occasionally needed a manual nudge. A programmatic
  pixel-color-sampling step (rather than asking the model to guess a hex code)
  would tighten this — a good next iteration, not required for the MVP.
- **The prompt trades some visual fidelity for Outlook safety, on purpose.**
  A real-world test (a bank e-statement email with rounded "card" boxes and
  drop shadows) showed the model's first instinct is to reach for raw
  `<div>`-based layouts with `box-shadow`/`border-radius` styling. That looks
  fine in a browser preview but is exactly what breaks in Outlook desktop
  (unsupported CSS, and `<div>`s can land in invalid positions in the compiled
  table markup that Outlook's renderer won't silently recover from the way
  browsers do). `lib/prompt.ts` now explicitly steers the model toward native
  MJML components instead, even when it costs some pixel-perfection in the
  preview — see the comment at the top of that file for the reasoning.
- **No persistence.** Nothing is saved server-side; each conversion is a
  single stateless request. Fine for validating demand; you'd want to add
  storage (saved conversions, projects) once people are actually using it.
- **Single image upload, one email at a time.** No batch processing yet.

## Suggested next steps once this is working for you

1. Keep testing on messier, real-world email screenshots — the Outlook-safety
   prompt rules were written from one real test (a bank email); more examples
   will surface more edge cases worth steering the model away from.
2. Add the pixel-color-sampling improvement for exact brand colors.
3. Decide on a monetization test: a usage-based free tier + paid tier, sold to
   marketers/agencies rather than developers (that's the differentiated niche
   this was scoped for — see the market research this project started from).
4. Only then consider auth, billing (Stripe), and persistence — don't build
   those before you know people want the core conversion to work well.
