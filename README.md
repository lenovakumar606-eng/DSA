# DSA
**Data Structures and Algorithms (DSA)** is a fundamental area of computer science 

## Weekly & Monthly Tracker

A personal tracker for logging daily work across four sections: **Study**, **AI Learning**, **Content Creation** and **Instagram**. It's in [`tracker/`](tracker/).

**How to use:** open `tracker/index.html` in any browser. Nothing to install and no server needed. To use it on your phone, host the folder with GitHub Pages (Settings → Pages → deploy from this branch) and open the link.

### Features
- **Email + password login.** Create an account, then sign in. Passwords are salted and hashed (PBKDF2), never stored as plain text. You can show/hide the password, change it from the ⋯ menu, and choose “Keep me signed in”.
- **Four colour-coded sections**, each with a table of Date · Day · Hours · What I learned / did.
- **Date picker.** The Day fills in automatically.
- **Weekly view (Mon–Sun):** hours per section and the weekly grand total.
- **Monthly view:** hours per section, active days, the grand total and a bar chart.
- **Add, edit and delete** entries. Use the "+ Add" button on a section or the floating ＋ button.
- **Auto-save** to browser storage, plus JSON **export/import** for backups (⋯ menu).
- **Reminders** (🔔) on the weekdays you pick or on a single date, at a time you choose. They pop up while the page is open. The 📅 Calendar button downloads an `.ics` file you can add to your phone or laptop calendar, so the reminder still fires when the page is closed.
- **Dark mode.** It follows your system setting, and the 🌙/☀️ button switches it manually.
- **Responsive layout** for phone and laptop.

> Note: there is no server, so accounts exist only in this browser on this device. The password stops other people using the app on a shared device, but the saved entries themselves are not encrypted. A forgotten password cannot be recovered; “Forgot password?” resets the account and erases its data on this device. Use Export to back up or move your data.
