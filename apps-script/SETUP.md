# Name the Mascot — setup

Two pages are already live on GitHub Pages. The only thing you have to create is the
backend, which is one Apps Script file attached to a Google Sheet. Budget five minutes.

| Page | Who opens it |
|---|---|
| `…/clutch-ai-games/mascot-host/` | You, on the presentation laptop |
| `…/clutch-ai-games/mascot/` | The audience — they get there by scanning your QR code |

---

## Step 1 — Make the Sheet

1. Go to <https://sheets.new> and name it **Name the Mascot**.
2. **Extensions → Apps Script**.
3. Delete whatever is in `Code.gs` and paste in the whole of **`apps-script/Code.gs`** from this repo.
4. Click the save icon.

## Step 2 — Authorise it

1. In the function dropdown at the top, choose **`setup`**, then click **Run**.
2. Google will warn you: **Review permissions → pick your clutch.ca account →
   Advanced → Go to Name the Mascot (unsafe) → Allow.**
   That warning is normal for a script you wrote yourself and have not submitted for review.
3. Look at the **Execution log** underneath. It prints two things — copy both:

   ```
   PIN: 4071
   Presenter key: k3m9x2qp7w
   ```

   Lost them later? Run **`showHostKey`** and look at the log again.

## Step 3 — Deploy it as a web app

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** `Me`
   - **Who has access:** **`Anyone`**
4. **Deploy**, then copy the **Web app URL**. It ends in `/exec`.

> ### ⚠️ Stop here if "Anyone" is not in the dropdown
> Some Workspace tenants only offer *"Anyone with a Google account"* or
> *"Anyone within Clutch"*. Neither works — phones would be forced to sign in to
> Google, and the page could not call the script at all.
> **If "Anyone" is missing, stop and tell me.** I'll switch the backend to a host
> that doesn't have that restriction. Everything else stays as it is.

## Step 4 — Connect the presenter page

1. Open **`…/clutch-ai-games/mascot-host/`** on the laptop you'll present from.
2. Paste the **`/exec` URL** and the **presenter key**, then **Connect**.
3. Both are saved in that browser, so you only do this once. The red
   **Disconnect this laptop** button under *Round and session controls* clears them.

## Step 5 — Add the mascot

Use **Mascot image → choose file** on the left of the dashboard. It's resized to
600px in your browser before it's uploaded, so a big PNG straight from the generator
is fine. It appears on every phone while people are thinking.

## Step 6 — Rehearse with two phones

Do this once before the session. Scan the QR with two phones, join with two
different names, submit, vote, reveal, then hit **New round**. It takes two minutes
and it's the only part of this I could not test for you.

---

## Running it on the day

| What you do | What the room does |
|---|---|
| Project the dashboard on the lobby screen | They scan the QR, enter a name, and wait |
| **Start submissions** | 60-second clock on the screen and on every phone; they type a name and can edit it until zero |
| *(nothing — it's automatic)* | At zero everyone moves to voting by themselves |
| **Close voting and reveal** | Winner, vote count, and the submitter's name, with confetti |
| **New round** | Same QR, same PIN, everyone rejoins |

- The submission clock is **60 seconds** by default. Change it under
  *Round and session controls → Submission seconds* before you start.
- A tie sends the tied names to an automatic **runoff** — press
  *Close voting and reveal* a second time once the room has voted again.
- **Reset everything** wipes all rounds and issues a new PIN. You won't normally need it.

## Changing the code later

Edit the script, then **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**.
Use *Manage deployments*, **not** *New deployment* — a new deployment mints a new
`/exec` URL and your QR code would stop working.

## Where the data lives

The Sheet. Five tabs appear by themselves:

| Tab | What's in it |
|---|---|
| `Game` | One row: PIN, round, stage, deadline, presenter key |
| `Players` | Who joined each round, with their nickname |
| `Entries` | One mascot name per player per round |
| `Votes` | One row per vote, with the phase (main or runoff) |
| `Image` | The mascot, split into chunks because of the 50k-character cell limit |

Nothing is deleted by a **New round** — every round stays in the Sheet, so you can
look back at what the room came up with.

## Known limits — worth knowing before you present

- **Someone could vote twice** by using a different browser *and* a different
  nickname before voting opens. Joining is blocked once voting starts, and refreshing
  or reopening the same phone resumes the same player. For a room of 13 colleagues
  that's the right trade-off; locking it down properly would mean accounts.
- **Nicknames must be unique.** Two people typing "Sam" become the same player.
  If that happens, one of them picks "Sam K".
- **The script sleeps between sessions.** The very first request after a quiet spell
  can take a couple of seconds. Load the dashboard a minute before you present.
