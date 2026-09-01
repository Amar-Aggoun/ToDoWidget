# 📝 ToDoWidget

A lightweight, frameless floating To-Do widget for Windows built with **Tauri v2** + **Rust**.

Runs silently in the system tray. Press **Ctrl+Shift+Space** to instantly bring it up over any window.

---

## Features

- 🚀 **Ultra-lightweight** — <30 MB RAM while idle
- ⌨️ **Global hotkey** — `Ctrl+Shift+Space` (customizable)
- 📦 **System tray** — runs silently in the background
- ★ **Priority levels** — High / Medium / Low with color-coded borders
- 📈 **Progress tracking** — 0–100% progress bars per task
- ⏰ **Deadline badges** — visual warnings for overdue & due-soon tasks
- 📂 **Linked folders** — attach local directories and open them in Explorer
- 🔔 **Desktop notifications** — alerts 1 hour before & when overdue
- 🔄 **Auto-start** — optionally launch on Windows boot
- 🖱️ **SQLite storage** — fast, local, persistent

---

## Prerequisites

Run the included setup script which will guide you through installing:

1. **Node.js** (v20 LTS) — [nodejs.org](https://nodejs.org/)
2. **Rust** — [rustup.rs](https://rustup.rs/)
3. **Microsoft C++ Build Tools** — [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select *Desktop development with C++*)

---

## Quick Start

```bat
# 1. Run the setup assistant (installs dependencies)
setup.bat

# 2. Launch in development mode (hot-reload)
npm run tauri dev
```

---

## Building a Release .exe

```bat
build_output.bat
```

Outputs `output\ToDoWidget.exe` — a single portable executable.

---

## Push to GitHub

```bat
push_to_github.bat
```

Interactively initializes Git and pushes to your GitHub repository.

---

## Automated CI/CD

The included `.github/workflows/build-exe.yml` automatically:

- Compiles the `.exe` on every push to `main`
- Attaches the binary as a downloadable artifact
- Creates a **GitHub Release** with the `.exe` when you push a version tag (e.g. `git tag v1.0.0 && git push --tags`)

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Show/Hide widget (global, works anywhere) |
| `Escape` | Hide widget / close modal |

---

## Data Storage

Tasks are stored in SQLite at:
```
%APPDATA%\com.todowidget.app\todos.db
```

---

## Project Structure

```
ToDo/
├── src-tauri/          Rust backend
│   ├── src/
│   │   ├── main.rs     Entry point
│   │   └── lib.rs      All backend logic
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                Frontend
│   ├── main.js         App logic
│   └── styles.css      Glassmorphism dark theme
├── index.html
├── setup.bat           Prerequisites installer
├── build_output.bat    One-click release build
└── push_to_github.bat  Git push automation
```
