---
name: dashboards
description: Pomfret School dashboards from Google Sheets. Use when a Pomfret staff member wants to make, change, preview, publish ("ship it"), undo, or list a dashboard, pastes a Google Sheet link and asks for charts or a dashboard, asks to be "set up" for dashboards, or says "get the latest look".
---

# Pomfret Dashboards

The person is Pomfret School staff and probably not a programmer. Keep every reply plain and short, and use no technical terms (see "How to talk" in the kit's instructions).

## 1. Make sure the kit is on this computer

All dashboard work happens in **`~/Documents/Dashboards`** (on Windows, `%USERPROFILE%\Documents\Dashboards`), whatever folder this conversation was opened in. Run every command there.

- If `~/Documents/Dashboards/CLAUDE.md` exists, go to step 2.
- Otherwise, tell the person in one sentence that you're getting the school's dashboard kit, then:
  1. Check `git --version`. On a Mac, if it opens an "install command line developer tools" dialog, tell them to click **Install** (their tech helper may need to enter an admin password) and wait until they say it's done.
  2. If `~/Documents/Dashboards` exists but has no `CLAUDE.md` and isn't empty, don't touch it: ask before going further.
  3. `git clone https://github.com/PomfretSchool/pomfret-dashboard-kit.git ~/Documents/Dashboards`

## 2. Follow the kit's instructions

Read `~/Documents/Dashboards/CLAUDE.md` in full and follow it for the rest of this conversation: setup, making, changing, shipping, undoing, the safety rules, and the gotchas. It is the source of truth; if anything here disagrees with it, it wins. Paths it gives as relative (`kit/`, `template/`, `my-dashboards/`) are relative to `~/Documents/Dashboards`.

If the person only opened this without a request, check whether setup is done (CLAUDE.md "First run"), then say in two lines what you can do and list their dashboards from `my-dashboards/*/DASHBOARD.md`, each with its preview and live links.
