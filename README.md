# Chorezilla

A family timetable. Parents build the week, everyone checks in each day, and the weekly crown goes to whoever followed the routine. Missed time is shown as minutes and as the points that got away.

The real app is a small Node server. It serves `site/` and a JSON API, and it keeps every household in one SQLite file. GitHub Pages can still publish `site/` as a **demo only**: the sample family stays in that browser and is not shared.

## Run locally

Requires Node 22.13+.

```bash
npm test
npm start
```

Open <http://localhost:8080/>. `npm start` creates `data/chorezilla.sqlite` in the current directory. Set `DATA_DIR` to put the file somewhere else:

```bash
DATA_DIR=/var/lib/chorezilla npm start
```

`PORT` defaults to 8080. `HOST` defaults to `0.0.0.0`.

## Sign in

A parent creates the household and chooses a password (at least 8 characters). That password belongs to the parent who created the house.

Everyone else joins with the invite code, picks their name (or claims a name a parent already added), and chooses a 4-digit PIN. Coming back is the same code, the same name, and the PIN. The creating parent signs in with the household password.

Passwords and PINs are stored with scrypt. The session is an httpOnly cookie. Eight wrong tries on a name lock that login for 15 minutes.

The server writes the points. A check-in from the browser cannot choose its own total. After a parent approves or overrides a row, the kid cannot change it. Each request is limited to the signed-in household.

## Demo

On a server, **Play the sample family** opens The Roar House (Alex, Mia, and Leo) in this browser only. **House → Reset sample family** puts the original week back.

The GitHub Pages workflow still deploys `site/` when those files change. That URL has no database, so it goes straight to the sample family. Shared check-ins need the Node server.

## Scoring

A routine has a length and a point value. `site/scoring.js` is what the page shows. `server/store.js` uses the same module when it saves a check-in.

| Mark | Points | Time counted as wasted |
| --- | --- | --- |
| Done | All of them | None |
| Half | Half, rounded half up | Half the minutes, rounded the same way |
| Missed | Nothing | The whole slot |
| Still open | Not scored | Not wasted |

Half of 5 is 3. Half of 15 is 8. A miss of a 30 minute, 15 point routine reads "You lost 30 minutes = 15 points."

Today's routines stay open until the end time. After that, an unmarked routine counts as missed. Days before the routine was added are ignored. The crown is the most points from Monday through Sunday on the device clock. A tie breaks to fewer wasted minutes, then the longer streak. A streak day means every routine was Done.

## The database file

The file is `$DATA_DIR/chorezilla.sqlite` (`./data` if `DATA_DIR` is unset). SQLite is a file. If the disk disappears, the households disappear.

Copy it while the app is running:

```bash
DATA_DIR=/var/lib/chorezilla npm run backup
```

That writes `backups/chorezilla-<timestamp>.sqlite` inside the data directory (or pass a path: `npm run backup -- /safe/place/chorezilla.sqlite`). Parents can also use **House → Download household data**, which is a JSON copy of their own house, not the whole database.

Put the server behind HTTPS. Fly.io and Render set `x-forwarded-proto`, and the session cookie is then marked Secure. For a plain local HTTP server, leave that unset.

## Hosting

The process is one Node server and one file. Anything that gives that file a disk which survives restarts will work.

| Place | Does the file survive a redeploy? |
| --- | --- |
| Your own PC, a Raspberry Pi, or a small VPS with a normal disk | Yes, if `DATA_DIR` is on that disk |
| Docker with a volume mounted at `/data` | Yes |
| [Fly.io](https://fly.io) with a [volume](https://fly.io/docs/volumes/) mounted at `/data` | Yes. A Fly machine without a volume loses the file |
| Render **paid** disk, or any host with a persistent disk mounted at `DATA_DIR` | Yes |
| Render free web service, Railway free, Fly without a volume, or any other ephemeral disk | No. Redeploy or restart gives you an empty database |

Example with Docker on a machine you control:

```bash
docker build -t chorezilla .
docker run -d --name chorezilla -p 8080:8080 -v chorezilla-data:/data chorezilla
```

On Fly, create a volume, set `DATA_DIR=/data`, and mount the volume there before the first real household. Back up the file (`npm run backup`, or `fly ssh sftp get`) before you destroy a volume.

Node 22 still marks `node:sqlite` experimental, so the start command passes `--experimental-sqlite`. The schema is `server/schema.sql`.

## Tests

```bash
npm test
```

That covers scoring, the crown, the sample week, the API (passwords, PINs, points the client cannot override, parent locks, and households staying apart), and the backup copy.

## Layout

```text
server/index.js          HTTP, cookies, static files
server/store.js          households, check-ins, points
server/schema.sql        SQLite tables
server/db.js             open the file and migrate
server/backup.js         copy the database
site/                    the pages the server (and GitHub Pages) serve
lib/scoring.js           same rules the server saves
```
