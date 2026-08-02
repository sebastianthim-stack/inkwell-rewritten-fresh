# Inkwell, rewritten. — Landing page (`site/`)

The deployable artifact for the **Inkwell Rewritten / Library Card** campaign.
A vanilla three.js (r160) scroll-driven landing page, no build step, no backend.

## What's here

| File | Purpose |
|---|---|
| `index.html` | Full copy, real DOM content, the sign-up form, progressive-enhancement boot |
| `style.css` | Design tokens, states, focus rings, reduced-motion kill switch |
| `app.js` | The WebGL scene (ink-bloom cloud → books drift → proof ambience → the card), tier-adapted, bloom on/off |
| `logo.svg` | Static hero art used by the reduced-motion / no-WebGL fallbacks |
| `.nojekyll` | Tells GitHub Pages not to run Jekyll |

## How the page degrades

1. **Full experience** — WebGL available + no `prefers-reduced-motion`. Canvas renders
   behind the DOM; camera is driven by scroll progress; `UnrealBloomPass` at half res.
2. **Reduced motion** — no canvas at all. A static hero (SVG ink-bloom logo), normal
   scrolling page, content never hidden behind reveals, instant anchor scroll.
3. **No WebGL / context lost / import failure** — same static hero + working form, plus
   a quiet note: *"Your library's in book-lending mode — everything here still works."*

Performance tiers picked at boot (`A` desktop high / `B` touch / `C` low-mem), with a
live FPS watcher that halves particles → halves books → drops bloom → drops pixel ratio.

## Run locally

```bash
cd site
python3 -m http.server 8000
```

Open http://localhost:8000. No build step.

## Email capture

Inkwell has no backend, so the form defaults to a **well-formed `mailto:`** that opens
the visitor's mail client with a prefilled subject (`Library Card request — <name>`) and
a body containing the email + consent line, addressed to `hello@inkwellbooks.ie`.
Success state still shows with a fallback link if no mail client opens.

To use a real free-tier endpoint instead, set `CAPTURE.formEndpoint` in the form script
inside `index.html` (search for `formEndpoint`) to a Formspree/Basin URL, e.g.
`https://formspree.io/f/XXXX`. The same validation and consent flow applies.

GDPR: email + required, **unchecked** consent line ("Yes, email me Inkwell news and
events. Unsubscribe anytime."). Never pre-ticked. Errors and success announce via
`role="alert"` / `role="status"`.

## Deploy to GitHub Pages

```bash
# from the repo root containing only these site files on main
git init -b main
git add -A
git commit -m "Inkwell, rewritten. — landing page"
git remote add origin git@github.com:OWNER/inkwell-rewritten-fresh.git
git push -u origin main

# enable Pages from main / root
gh api -X POST repos/OWNER/inkwell-rewritten-fresh/pages \
  -f source[branch]=main -f source[path]=/

# verify
curl -sI https://OWNER.github.io/inkwell-rewritten-fresh/
```

No Jekyll preprocessing (`.nojekyll` present); ES modules load via the import map in
`index.html` from the jsDelivr CDN.
