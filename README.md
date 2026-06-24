# PBE Quiz Generator (Static Site)

Static HTML/CSS/JS site for generating:
- Printable quizzes
- PowerPoint quiz decks
- Interactive web quizzes

The app reads question files from `questions/v1` and runs without a backend, so it works on GitHub Pages and local static hosting.

## Current Features

- Filter by question type
- Filter by one or more difficulty metadata values
- Select individual verses within selected chapters
- Human-reviewed-only filter (`validatedBy = human`)
- Total question count target
- Number-per-verse cap
- Realtime generation as selections change
- Year selector (config file based)
- Person profiles saved in browser localStorage
- Multi-person selection for printable output sections
- Print view with question sheets and answer key sheets
- PowerPoint deck export (client-side via vendored PptxGenJS)
- Interactive quiz mode with scoring

## Run Locally

Use a local static server for normal hosted-like behavior.

### Option A: Python

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

### Option B: VS Code Live Server

Open `index.html` with Live Server.

## Local File Mode (No Server)

This project now supports opening `index.html` directly from `file://` by using a generated JS data bundle.

1. Generate or refresh the bundle:

```bash
node scripts/build-local-bundle.mjs
```

2. Open `index.html` directly in your browser.

The app will use `questions/v1/local-data.bundle.js` automatically when present, and use fetch-based JSON loading when hosted or served.

## GitHub Pages

1. Push this repository to GitHub.
2. In repository settings, enable GitHub Pages from the root (or main branch root).
3. Open the published URL.

No build step is required.

## Data Files

- Manifest: `questions/v1/manifest.json`
- Chapters: `questions/v1/by-chapter/<book-id>/<chapter>.json`
- Year mapping: `questions/v1/years.json`

If `years.json` has no scope for a year, that year defaults to all books and chapters in the manifest.

### years.json format

```json
{
  "schema": "pbe.year.scope.v1",
  "version": 1,
  "years": [
    {
      "id": "2026-current",
      "name": "2026-2027",
      "scope": {
        "41-mark": [1, 2, 3],
        "60-1-peter": [1, 2, 3, 4, 5]
      }
    }
  ]
}
```

`scope` is optional. If omitted, all manifest chapters are included for that year.

## Verse Selection UX

- Chapter checkboxes still control the primary scope.
- Each selected chapter has a verse picker with `All verses` as the default.
- Quick actions inside each chapter picker: `All`, `Clear`, and `Range` (`start` + `end` + `Apply`).
- Choosing custom verses limits generation to questions whose references overlap those verses.
- Custom verse choices are saved per person profile in localStorage.

## Notes and Limits

- Difficulty filters use the `difficulty` field in each question (`easy`, `medium`, or `hard`) and can include any combination of those values.
- PowerPoint export uses local vendored libraries in `assets/vendor/jszip.min.js` and `assets/vendor/pptxgen.min.js`, so CDN access is not required.
- The included sample deck (`2023-NAD-PBE-Practice-Test.pptx`) is used as style direction, not binary template injection.
- If `manifest.json` references a missing chapter file, bundling skips that chapter and logs it.

## Third-Party Licenses

- Notices and dependency metadata: `THIRD_PARTY_NOTICES.md`
- License text copies: `licenses/`

## Next Enhancements

- Add optional profile export/import JSON for sharing across devices.
- Add fill-in-the-blank source integration when external API contract and CORS are finalized.
