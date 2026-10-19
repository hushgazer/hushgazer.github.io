# Hush Media Creations · client picks site — tools & workflow

Static site for GitHub Pages (https://hushgazer.github.io/). No backend, no login,
no passwords, no trackers, no external scripts. Picks are emailed through FormSubmit.

## 1. Add a project (only when Hush says the collages are FINAL)

1. Get the exact full-quality file paths + character count per collage from the image bot.
2. Copy the files unchanged into `projects/<slug>/` (e.g. `collage-1.png` …) and write
   `projects/<slug>/project.json`:
   ```json
   {"title": "Kraken", "description": "…", "packSize": 8,
    "collages": [{"file": "collage-1.png", "options": 7, "label": "Collage 1"}]}
   ```
3. `python3 tools/new_project.py <slug> "Title" --desc "…" --detect --image-bot <agent-id>`
   * creates `/<slug>/index.html`, lists the project on the home page
     (`"hidden": true` in `projects/projects.json` keeps it off the home page, e.g. `demo`)
   * `--detect` runs `tools/detect_columns.py` on every collage and saves `"columns"`
     (N+1 pixel cut positions). For transparent PNGs it anchors on the printed option
     numbers; collages whose numbers can't all be found use the project's median layout
     (reported as LOW CONFIDENCE). Always look at the overlays in
     `tools/out/<slug>-<collage>-columns.png` before publishing.
   * also sets `"cropTop"` when a header text strip is found (trimmed in crops/lineup)
   * `--image-bot` saves `"imageBot"` so picks go back to the bot that made the project
   * Client UX (pick-cheer toasts, submit celebration, stale-page auto-reload) lives in
     shared `assets/` — the template just links them; `new_project.py` re-runs
     `inject_gate.py` with the current `assets/build.json` version so cache-bust stays aligned.
4. Give each client a personal link (no passwords):
   `python3 tools/add_client.py <slug> Julius --role decider`
   `python3 tools/add_client.py <slug> Adam --role advisor`
   * token like `julius-k7Qm2xP9aB3c`; only its SHA-256 (`keyHash`) goes into project.json
   * raw tokens + links are saved in `tools/private/client-links.json` (git-ignored, mode 600);
     re-running prints the saved link, `--rotate` replaces it
   * link: `https://hushgazer.github.io/<slug>/?c=<token>`
   * no/bad token → polite "needs your personal link" message, collages view-only
   * no `"clients"` array → fallback: required "Your name" field
5. Run the checks (section 5), commit, push.

## 2. Roles: decider + advisor

* **advisor** (e.g. Adam): picks + optional note per collage + overall opinion.
* After an advisor submits, publish their opinion for the decider:
  `python3 tools/publish_opinion.py <payload.json>` (alias: `add_opinion.py`).
  It checks the payload's `clientTag` belongs to an advisor, refuses `test:true`
  payloads, and writes `"opinions"` into project.json. Commit + push.
  Remove: `python3 tools/publish_opinion.py --project <slug> --remove Adam`.
* **decider** (e.g. Julius) sees a small "Adam's pick" tag on the character and an
  "Adam's opinion" section below the last collage (above the submit area).
* Note: project.json is public, so a published opinion is readable by anyone who has
  the project URL (same as the collages).

## 3. Client page features

* Tap characters to pick them (**as many as you want per collage**); tap a selected
  character again to unpick it. Submit stays disabled until every collage has ≥1 pick.
  Picks are saved in the browser per project **and** per client, so two clients on one
  device never mix.
* **Pack slots (sticky bar)**: each project has a fixed **`packSize`** (or `slots`)
  in `projects/<slug>/project.json` (default **8** if missing — independent of how
  many collages there are). The sticky bar always shows exactly that many numbered
  boxes. Filled slots are your picks (drag to swap / move; × clears a slot back to
  empty without collapsing holes). Empty slots mean **NEW / remake requested** for
  that pack position. Tap a character → fills the first empty slot; tap again →
  unpicks and clears it from any slot. Bar shows `N of M pack slots filled` and a
  short “Feel free to move things around” hint. **Download lineup** saves a
  full-resolution PNG of the pack (empty slots drawn as NEW).
* Payload schema **`hush-picks/v2`**: each collage entry has `selected: number[]` and
  `option: number|number[]` (single number when only one pick), plus `crops[]`.
  `lineup` is a fixed-length array of length `packSize`: each item is
  `{collage, option, previewIndex}` or **`null`** (remake). `summary` lists empty
  slots as `#N NEW / remake requested`. Older `hush-picks/v1` still works in the
  sheet tools.
* Subject: `Hush picks: <Title> - <Client> #<clientTag> (<slug>)`.

## 4. Test mode (Hush only) and the picks-watcher

* Add `?test=1` to any project URL (works with `?c=`): orange banner
  "TEST MODE · submissions are marked as tests", **Clear my picks** and **Exit test mode**
  links. Remembered for that browser tab (sessionStorage); `?test=0` turns it off.
  Clients never see any of this without the parameter.
* Test submissions: subject starts with `[TEST] `, payload has `"test": true`,
  email body has `test: yes`, and **no `_cc` copy** is sent.
* **Instant alerts**: every REAL submission goes to the FormSubmit inbox
  (hushgazer@gmail.com) **and** is copied via FormSubmit `_cc` to
  `hushmediacreations+picks@mail.grokbot.com` (Hush Media Creations' bot inbox) so the
  picks are noticed instantly. Change `FORM_CC` in `assets/project.js` to update it.
* **Picks-watcher** (routine): reads new "Hush picks:" emails, extracts the JSON between
  `HUSHPICKS_JSON_BEGIN` and `HUSHPICKS_JSON_END`, and
  * **skips** any email whose subject contains `[TEST]` or whose payload has `test: true`
  * skips already-handled ones (state in `processed-picks.json`, git-ignored)
  * for an advisor payload: `publish_opinion.py` (after Hush OKs publishing)
  * for a decider/client payload: builds the picks sheet + marked copies and sends them
    with the file paths and option numbers to the project's `imageBot`, then tells Hush.

## 5. Picks sheet and marked copies

`python3 tools/make_picks_sheet.py payload.json [-o out.png] [--project-dir DIR]`
* sheet: each chosen character cropped 1:1 from the ORIGINAL collage, labelled
  "Collage X - option Y" (transparent collages are shown on white). Multiple picks on
  one collage → multiple tiles.
* marked copies: `<out>-marked/<collage>-pick<N>.png` — the full-size original with
  **every** selected character on that collage outlined + "PICK #N" (one file per
  option; lossless PNG, same size, source untouched)
* prints `imageBot: <id>` when project.json has one

## 7. Admin: Hide / Unhide / Delete (Hush only)

* Sign-in page: **https://hushgazer.github.io/admin/** (local: http://127.0.0.1:8765/admin/).
  It is not linked from the home page or any client page and is `noindex`. Client pages
  (Julius/Adam personal links) never have a login or password field.
* Name: **Hush**. Password: ask Hush, or see the private notes in `tools/private/`
  (git-ignored, never published). Change it with `python3 tools/add_admin.py` (prompts);
  only `SHA-256("Hush|<password>")` is written into `assets/admin-login.js`.
* After sign-in the tab keeps `sessionStorage` `hush-admin=1` (+ a signing key) and goes to the
  home page with a purple **ADMIN** bar. Home lists every project, including hidden ones, each
  with **Hide/Unhide** and **Delete** (project-level). **Sign out** clears the session
  (closing the tab does too). **Test mode** stays in the admin bar.
* **Project pages** do **not** hide/delete the whole project from the admin bar. Instead each
  collage section shows **Hide collage** / **Show collage** / **Delete collage**. Hide and
  Delete always ask for confirmation first (Delete: "Delete this collage permanently?").
  Hidden collages vanish for Julius/Adam after publish; admin still sees them greyed with
  **Show collage**. The UI updates immediately (optimistic); the live site updates after the
  automation applies + pushes (usually a few minutes).
* **Hidden project** (`"hidden": true` in `projects/projects.json`): left off the public home
  page; the project URL shows "This project isn't available right now" to anyone not signed
  in. **Hidden collage** (`"hidden": true` on a collage entry in `projects/<slug>/project.json`):
  omitted for clients; admin still sees it greyed.
* **Optimistic UI**: Hide / Unhide flip this tab immediately; **Delete collage** only
  greys out until FormSubmit accepts, then removes it from the tab. On send failure the
  tab reverts and shows **NOT PUBLISHED**. The signed FormSubmit request still goes out
  for audit; `admin_action.py --from-email` always pushes so Pages updates.

* **Publish reliability:** Hide/Delete only stay “done” in the admin UI after FormSubmit
  **accepts** the request. If send fails, the UI reverts and shows **NOT PUBLISHED**.
  `--from-email` always `--push`es (unless `--no-push`) so applied actions hit GitHub Pages.
  FormSubmit can still accept a request while email delivery is delayed (GitHub/webhook
  outages) — if live does not change within a few minutes, tell the bot; do not assume
  the collage is gone. No Lion delete-collage emails were found for the lost deletes.
* Each button click emails a signed request through FormSubmit (same `FORM_TARGET` as the
  picks, copied via `_cc` to the bot inbox). Subjects:
  - project: `Hush admin: <hide|unhide|delete> <slug>`
  - collage: `Hush admin: <hide-collage|show-collage|delete-collage> <slug> <file>`
  Payload between `HUSHADMIN_JSON_BEGIN` / `HUSHADMIN_JSON_END`:
  `{"schema":"hush-admin/v1","action","slug","file?","title","by","at","nonce","sig"}` where
  project `sig = HMAC-SHA256(signKey, "hush-admin/v1|action|slug|at|nonce")` and collage
  `sig = HMAC-SHA256(signKey, "hush-admin/v1|action|slug|file|at|nonce")`.
* **Picks routine**: for a "Hush admin:" email, save the email text and run
  `python3 tools/admin_action.py --from-email mail.txt --push` (add `--remove-files` for
  project delete). It rejects bad signatures, replays and requests older than 7 days
  (exit code 2). `--push` commits and pushes so GitHub Pages updates.
* By hand / local preview (the local admin bar never emails; it shows the command):
  `python3 tools/admin_action.py hide|unhide <slug>`,
  `python3 tools/admin_action.py delete <slug> [--remove-files]`,
  `python3 tools/admin_action.py hide-collage|show-collage|delete-collage <slug> <file> [--push]`.
* Caveat: this sign-in is a convenience gate (the hash is public and a short password can be
  guessed). Nothing changes on the site unless `admin_action.py` verifies the signature, so a
  stronger password makes forged requests harder. Hidden projects' slugs are still listed in
  the public `projects.json`.
* Test: `python3 tools/test_admin.py` (server on :8765; FormSubmit mocked).


## 8. Display WebP (automatic — faster client loads)

PNG collages in `projects/<slug>/` stay the **full-quality masters** (detect_columns,
picks sheets, crop math). Clients load a high-quality **`.webp` sibling** for display
(PNG fallback). Quality default **88** (~¼ the PNG bytes for Lion/Kraken; no downscale).

**You do not run this by hand for normal work.** It runs automatically when:
* `python3 tools/new_project.py …` finishes (after collages are in place)
* `python3 tools/admin_action.py` hide/show-collage (refreshes missing/outdated WebPs)
* delete-collage removes the `.webp` next to the PNG

Rebuild / check sizes anytime:
```
python3 tools/optimize_display.py              # all projects
python3 tools/optimize_display.py lion --force # rebuild one
```

## 6. Checks before publishing

```
python3 -m http.server 8765 &          # from the site root
python3 tools/shoot.py                 # Playwright: picking, submit (FormSubmit MOCKED), test mode,
                                       # personal links, advisor/decider, lineup, CSP errors
python3 tools/test_detect_columns.py   # column detection self-test
python3 tools/test_admin.py            # admin sign-in, hide/delete requests + verification
java -jar vnu.jar --also-check-css index.html project.html 404.html */index.html assets/style.css
```
Tests never send real submissions: FormSubmit is mocked and all other internet requests
are blocked. Never commit `tools/private/`, `preview-projects/`, `processed-picks.json`.
