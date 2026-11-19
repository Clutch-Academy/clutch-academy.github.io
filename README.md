# Clutch Academy live games

Audience games for Clutch Academy sessions. Static pages, no build step.

- **[Name the Mascot — presenter](https://clutch-academy.github.io/mascot-host/)**
- **[Name the Mascot — players](https://clutch-academy.github.io/mascot/)** (reached by scanning the presenter's QR code)

## Name the Mascot

The room scans a QR code, submits a name against a 60-second clock, votes
anonymously, and the winner plus the person who wrote it are revealed.

Submissions and votes are shared across phones, so it needs a backend: one Apps
Script file bound to a Google Sheet. See **[apps-script/SETUP.md](apps-script/SETUP.md)**.

Run `./build-mascot.sh` after editing `mascot.html` or `mascot-host.html` to refresh
the clean-path copies in `mascot/` and `mascot-host/`.
