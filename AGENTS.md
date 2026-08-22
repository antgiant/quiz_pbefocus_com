# PBE Quiz Builder

## Go-live checklist: shared header/footer site nav

`index.html`'s header/footer nav (`[data-pbe-site-nav]` /
`[data-pbe-site-footer-nav]`) is populated at runtime by
`https://pbefocus.com/site-nav.js`, shared across pbefocus.com, this app
(quiz.pbefocus.com), and karaoke.pbefocus.com (pbe-playlist) — see that
file's `SITES` array in the `pbefocus.com` repo. This app's `quiz` entry
there currently has `live: false`, so it only shows up in *this* site's own
nav (forced in via the current-site override) and stays hidden from
pbefocus.com's and karaoke's nav. **When this app actually goes live** (repo
pushed to GitHub, `quiz.pbefocus.com` DNS/CNAME live, GitHub Pages serving
it), flip `quiz`'s `live` to `true` in `pbefocus.com/site-nav.js` and
redeploy that repo — otherwise this app stays invisible from the other two
sites' navs indefinitely.
