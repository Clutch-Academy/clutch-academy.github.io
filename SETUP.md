# Name the Mascot — setup

Everything is already running. This page is here so you can rebuild it, or hand it
to someone else, without asking me.

| Page | Who opens it |
|---|---|
| <https://clutch-academy.github.io/mascot-host/> | You, on the presentation laptop |
| <https://clutch-academy.github.io/mascot/> | The room — they get there by scanning your QR |

**The PIN and the presenter key are not in this repo.** They live in the database at
`secret/pin` and `secret/hostKey`, and can only be set from the Firebase console
(Realtime Database → Data). No client can read `secret/hostKey`; only the rules can.

## Running it on the day

| What you do | What the room does |
|---|---|
| Open the dashboard, unlock it with the key (once per laptop) | — |
| Project it on the lobby screen | They scan the QR, type a name, and wait |
| **Start submissions** | 60-second clock on every phone; they type a mascot name and can edit until zero |
| *(nothing — it's automatic)* | At zero every phone moves itself to voting |
| **Close voting and reveal** | Winner, vote count, who wrote it, confetti |
| **New round** | Same QR, same PIN, everyone rejoins |

- Change the clock under *Round and session controls → Submission seconds* before starting.
- A tie creates a **runoff** between the tied names. Press *Close voting and reveal* again once the room has voted a second time.
- Upload the mascot with **Mascot image → choose file**. It's resized to 600px in your
  browser, so a full-size PNG is fine.

## Watching it live

Firebase console → **Realtime Database → Data**. Submissions appear as people type them.
That is the whole database; there is no server.

## How it is put together

There is no backend. Both pages talk straight to Firebase Realtime Database over a
socket, and the security rules are what enforce the game.

| Rule | How it is enforced |
|---|---|
| One name each | `myEntry/<uid>` is write-once |
| One vote each | the vote node cannot be overwritten |
| No voting for yourself | rule compares against `entryOwner`, which players cannot read |
| No late submissions | checked against Firebase's clock, not a phone's |
| Nicknames, authorship, tallies | readable only by the presenter, including after the reveal |
| Presenter actions | only a device that has written the key to `hostClaims/<uid>` |

The round also closes on the server clock derived from `startedAt`, so if the presenter
laptop sleeps or drops wifi mid-round the game still advances on every phone. The
Start and Close buttons are hints, not the thing holding it together.

## Rebuilding the Firebase side from scratch

1. **console.firebase.google.com → Create a project** (Analytics off).
2. **Build → Realtime Database → Create Database → Start in locked mode.**
3. **Rules** tab → paste `firebase/database.rules.json` → **Publish**.
4. **Build → Authentication → Sign-in method → Anonymous → Enable.**
5. **Project settings → Your apps → Web (`</>`)** → register → copy the `firebaseConfig`
   into `mascot-config.js`. That file is public on purpose; the rules are the protection.

To change the PIN or the presenter key, edit `secret/pin` or `secret/hostKey` in the
Firebase console Data tab. Nothing in this repo changes and nothing redeploys.

## Changing the pages

Edit `mascot.html` or `mascot-host.html`, run `./build-mascot.sh` to refresh the
clean-path copies, then push. GitHub Pages picks it up in a minute or two. There is no
deploy step and no versions to manage.

## Known limits

- **Pick a real presenter key.** Anyone with it can drive the game. It is never in this
  repo, so it only leaks if you share it. Don't reuse a password you use elsewhere.
- **The PIN is public by design** — it is projected on screen. It only stops passers-by,
  not a determined person.
- **Two browsers on one phone are two players.** Anonymous sign-in is per browser
  profile, so someone determined could vote twice. Joining locks once voting opens,
  which is the practical mitigation.
- **Nicknames must be unique** for the reveal to name the right person.

## The old version

Before this, the backend was Google Apps Script with a Sheet. It worked but a single
poll took 1.9–8.8s, so phones lagged seconds behind the screen. It is recoverable at
the git tag `apps-script-fallback` if it is ever needed.
