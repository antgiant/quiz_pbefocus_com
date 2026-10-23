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
- Fill in the Blank questions generated from the NKJV verse text (see below)
- Reorderable people list: drag, or use the arrows, to change the order
- Intro/commentary passages for books that have them
- One-click import of presets from the old PBE Study Tool

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
- Practice books (with intro commentary) and seasons: `questions/v1/practice-books.json`, `practice-chapters-by-year.json`

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

## Fill in the Blank

Fill in the Blank questions are generated from the verses themselves, so every verse in your scope can
become a question. The blanked words are the most meaningful ones (names, nouns, verbs) chosen with the
`compromise` NLP library plus TF-IDF scoring, ported from the PBE Study Tool.

- **Match difficulty** (default): easy blanks up to 20% of a verse's words, medium over 20-40%, hard over
  40-80%. Each question picks a random percent inside its band, so verses blank differently each time.
  The difficulty filter and difficulty percentages work as they do for written questions.
- **Set it myself**: override the bands with a number of blanks or a percent of the words. Questions are still
  labelled easy/medium/hard by the share blanked, and only the difficulties you ticked are used.
- Points equal the number of blanks, so the PowerPoint and interactive timers scale with them.
- Written and generated questions can be mixed. With no percentages entered, a type's share follows how many
  questions it has (generated questions count once per verse); enter percents beside the types to set the mix.
- Generated questions skip the **Question Source** filter, since no author is involved.
- Intro/commentary passages appear as an **Intro** entry per book (fill in the blank only).
- Blanks are chosen once per quiz with a seeded random generator, so the preview, print view, PowerPoint
  and interactive quiz all show the same blanks.

Verse text is downloaded from bolls.life when a chapter is first needed and cached in IndexedDB, so repeat
visits are instant and work offline for chapters you've already used.

### Interactive quiz

Each blank is a text box in the verse; Tab or Enter moves between them and Enter on the last one submits.
**Hint** fills in the next blank. A blank filled by a hint counts as incorrect in the default score (you can still
adjust the points on the answer page), and the answer page notes how many hints were used. Using a hint on every
blank submits the question automatically.
Finishing a quiz celebrates with confetti (not shown if your system asks for reduced motion) and offers
**Practice again with new blanks**: the same verses with different words blanked.

## People

Each person keeps their own year, scope, verses, filters and fill-in-the-blank settings. Drag a person (or use
the arrow buttons) to reorder; names, order and settings save as you change them. Tick **Print** to include
someone in the printed quiz.

### Importing from the PBE Study Tool

The study tool links here with its presets in the URL (`#import=...`). The quiz builder asks before adding
them as people set up for fill in the blank practice (same chapters, verses and blank counts).

## Tests

```bash
npm install
npm test
npm run test:coverage
```

## Timers

The PowerPoint and interactive timers offer Florida (10 s first point, 5 s each additional), NAD (30 s, 10 s),
**Nearpod (NAD competition)** and a custom setting. Nearpod uses NAD timing rounded to 15-second steps, rounding up
more often than down (anything 5 s or more past a step goes up): 1 pt = 30 s, 2 = 45 s, 3 = 60 s, 4 = 60 s,
5 = 75 s, 6 = 90 s, 7 = 90 s, 8 = 105 s, and so on.

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

## Question Data Pipeline

Everything derived from `questions/v1/by-chapter/**` is generated, not hand-edited:

- `manifest.json`: books, chapters, verse/question counts and a content `hash` per chapter
- `packs/<season>.<hash>.json` and `packs/index.json`: one pack per season with all of its chapters
- `practice-years.bundle.js`, `practice-books.bundle.js`: script-tag copies of the practice JSON files

Seasons are defined in `practice-chapters-by-year.json` (upcoming seasons through 2035-2036 are already listed).
To add questions or a season, edit the source files and push to `main`: the
`Build question data` GitHub Action regenerates and commits the rest. To do it locally run
`npm run build:data`; `npm run check:data` fails when generated files are stale (the test suite checks this too).
