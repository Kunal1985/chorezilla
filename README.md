# Chorezilla

A family timetable. Parents build the week, everyone checks in each day, and the weekly crown goes to whoever followed the routine. Missed time is shown as minutes and as the points that got away.

The site is static HTML, CSS, and JavaScript in `site/`, deployed to GitHub Pages. Shared households use Supabase (magic-link auth, Postgres, row level security) from the browser with the public anon key. Until that is filled in, the site opens on a sample family stored in the browser.

Expected site: <https://kunal1985.github.io/chorezilla/>

## Demo

Open `site/index.html` through a local server, or open the Pages URL before Supabase is configured. You land in **The Roar House** with Alex (parent), Mia, and Leo. Use **See it as** to switch between the kid view and the parent view. Taps stay in `localStorage` on that device. **House → Reset sample family** puts the original week back.

## Scoring

A routine has a length and a point value. The same rule is in `site/scoring.js` (what the page shows) and in `supabase/migrations/001_init.sql` (what gets stored, so a browser cannot invent a total).

| Mark | Points | Time counted as wasted |
| --- | --- | --- |
| Done | All of them | None |
| Half | Half, rounded half up | Half the minutes, rounded the same way |
| Missed | Nothing | The whole slot |
| Still open | Not scored | Not wasted |

Half of 5 is 3. Half of 15 is 8. Half of 1 is 1. A miss of a 30 minute, 15 point routine is the line the kids see: "You lost 30 minutes = 15 points."

Today's routines stay open until the end time, so a morning check-in still counts before the clock runs out. After the end time, an unmarked routine counts as missed. Days before the routine was added are ignored. Archiving stops new misses; check-ins already saved stay on the board.

The crown is the most points that week (Monday through Sunday, on the device's clock). A tie breaks to fewer wasted minutes, then the longer streak. Nobody wears it until someone has points. Two people with the same points, waste, and streak share it.

A streak day means every routine that day was Done. Half or missed breaks it. Today does not break it while routines are still open and nothing was missed or half. A day with no routines is skipped.

Parents set the week's prize. Kids mark their own routines. Points count immediately. A parent can agree with **Looks right**, or override the mark. After a parent has checked a row, the kid cannot change it.

## Layout

```text
site/                         GitHub Pages (relative URLs, works under /chorezilla/)
  index.html, app.js, style.css
  scoring.js                  points, streaks, crown
  demo.js                     sample family
  config.js                   Supabase URL and anon key (empty = demo)
supabase/migrations/001_init.sql
lib/scoring.js                re-exports site/scoring.js for tests
test/                         node:test
.github/workflows/pages.yml   deploys site/ on pushes that touch it
```

Days on a routine are ISO: 1 is Monday, 7 is Sunday. A routine stays inside one day (bedtime is the window for getting to bed, not the hours asleep).

## Local

Requires Node 22+.

```bash
npm test
npm start
```

`npm start` serves `site/` at <http://localhost:8080/>. Tests cover scoring, the crown, the sample week, and that the migration enables row level security.

## Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** and run `supabase/migrations/001_init.sql` once.
3. **Authentication → Providers**: Email is enough. Magic link is the login.
4. **Authentication → URL configuration**
   - Site URL: `https://kunal1985.github.io/chorezilla/`
   - Redirect URLs: that same URL, plus `http://localhost:8080/` and `http://127.0.0.1:8080/` if you sign in locally.
5. **Project Settings → API**. Copy the project URL and the `anon` public key into `site/config.js`:

```js
window.CHOREZILLA_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_KEY"
};
```

`site/config.example.js` is the same shape. The anon key is meant for the browser. Do not put the service role key in this repo or in `config.js`. Row level security is what keeps one family from reading another. The invite code is the household key: anyone who has it can join, including as a parent, so only share it with the family. Parents can mint a new code from **House**.

Push the config change. The Pages workflow deploys `site/` when files there change.

First parent: sign in, **Create a family**, then add kid profiles (they do not need a login for a parent to mark their day). A kid with their own email signs in, enters the code, and claims their name. A second parent can join with the code as a parent.

The timetable uses the clock and timezone of the phone or laptop that has the page open. A household should be in one timezone.

## GitHub Pages

After this is on `main`:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** The URL is <https://kunal1985.github.io/chorezilla/>.
2. If the `github-pages` environment asks for approval, approve the deployment from the default branch.

The workflow is `.github/workflows/pages.yml`. It runs on pushes to `main` that change `site/` or the workflow, and from **Actions → Pages → Run workflow**. It stamps asset URLs with the commit SHA, then deploys the `site/` folder. Token permissions on that job are `contents: read`, `pages: write`, and `id-token: write`.

Demo mode is what visitors get until `site/config.js` has a real URL and anon key.
