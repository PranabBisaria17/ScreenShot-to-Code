# Deploying to Vercel (free)

Right now the app only runs when you have it open in VS Code with `npm run
dev`. Deploying it gives you a real URL that works from your phone, works
when your laptop is closed, and can be shared with anyone — for free, on
Vercel's hobby tier (the company that makes Next.js, so it's a natural fit).

This assumes you're starting from this project folder with no GitHub repo
yet. Takes about 10 minutes.

## 1. Push the code to GitHub

If you don't have a GitHub account, create one free at https://github.com.

Create a new **empty** repository (don't check "Add a README" — that avoids
a merge conflict with the code you already have):
https://github.com/new → name it e.g. `email2code` → Create repository.

Then, in a terminal opened in this project folder (in VS Code: Terminal →
New Terminal):

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-github-username>/email2code.git
git push -u origin main
```

Replace `<your-github-username>` with your actual GitHub username. GitHub
will show you this exact remote URL on the empty repo's page after you
create it — you can copy it from there instead of typing it by hand.

If you'd rather not use the terminal, VS Code's built-in **Source Control**
panel (the icon that looks like a branching line, in the left sidebar) can
do the init/commit/push with buttons instead — click "Publish to GitHub"
there once you've made a commit.

## 2. Import the project into Vercel

1. Go to https://vercel.com and sign up with **"Continue with GitHub"** —
   this is what lets Vercel see and deploy your repos.
2. Click **Add New → Project**, find `email2code` in the list, click
   **Import**. Vercel auto-detects it's a Next.js app — you don't need to
   change any build settings.
3. **Before clicking Deploy**, expand **Environment Variables** and add:
   - `AI_PROVIDER` = `gemini`
   - `GEMINI_API_KEY` = *(your actual key from
     https://aistudio.google.com/apikey — the same one from your
     `.env.local`)*
4. Click **Deploy**. It takes 1-2 minutes the first time.

You'll get a live URL like `https://email2code-yourname.vercel.app`. Open it
and test with a real screenshot to confirm the deployed version works, not
just your local one.

## Keeping it updated

Any time you `git push` new changes to the `main` branch on GitHub, Vercel
automatically rebuilds and redeploys within a minute or two — no manual
redeploy step. If you make local edits again later (with me or on your own),
the same `git add` / `git commit` / `git push` sequence ships them.

## Troubleshooting

- **"GEMINI_API_KEY is not set on the server" on the live site** — the
  environment variable wasn't added, or was added after the first deploy.
  Go to your Vercel project → Settings → Environment Variables, add it, then
  Deployments tab → the three dots (⋯) on the latest deployment → Redeploy.
- **Image cropping or color sampling works locally but fails only on
  Vercel** — this is a known class of issue with `sharp` (the image library
  this app uses) on serverless platforms, because it ships different native
  binaries per OS. `next.config.ts` already sets `serverExternalPackages:
  ["sharp"]`, which is the standard fix — but if you still see it, check
  Vercel's function logs (Project → Deployments → click a deployment →
  Functions tab) for the actual error and share it with me.
- **Free tier limits** — Vercel's hobby plan and Gemini's free tier are both
  generous enough for personal use and demos; you'd only need to think about
  this if the tool got real, sustained traffic (a good problem to have).
