# Pomfret Dashboard Kit

Pomfret School's shared look and feel for Google Sheets dashboards, plus the instructions that let Claude build, change and publish them for staff who don't write code.

Dashboards run as Google Apps Script web apps attached to the department's own Sheet. Staff never see code: they paste a Sheet link, describe what they want, check a **preview link**, and say **"Ship it"** to update their **live link**. [`CLAUDE.md`](CLAUDE.md) holds the full workflow and safety rules Claude follows.

## Getting started (for the person running the session)

**Before:** the staff member needs edit access to their Google Sheet and a pomfret.org Google account. A Mac may ask to install developer tools the first time, which can need an admin password.

**In the room (about 15 minutes the first time):**

1. Make an empty folder called **Dashboards** in their Documents.
2. Open the **Claude desktop app → Code tab** and choose that folder.
3. They paste:
   > Get https://github.com/PomfretSchool/pomfret-dashboard-kit into this folder and follow its CLAUDE.md to set me up.
4. Help them through the Google sign-in (their @pomfret.org account) and the Apps Script switch Claude links to.
5. They type: **"Make me a dashboard from** *[paste Sheet link]***"**, then describe what they want to see.
6. Open the preview link Claude gives, click **Review permissions → Allow** once, and look.
7. Ask for changes in plain words. When happy: **"Ship it."** Claude asks once who should be able to open it, then gives the live link.

**From then on:** open the Dashboards folder in the Code tab and say what you want: *"change…"*, *"ship it"*, *"undo that"*, *"show me my dashboards"*, *"get the latest look"*.

## What's here

| Folder | What it is |
|---|---|
| `kit/` | Shared CSS and JavaScript (`PD.*` helpers: KPI cards, bars, lines, tables, heatmaps, maps) |
| `template/` | Starting files for a new Apps Script dashboard |
| `examples/` | Six department dashboards on synthetic data, used as style references |
| `my-dashboards/` | Created on each staff computer; never committed |

Examples use invented data. No school data belongs in this repository.
