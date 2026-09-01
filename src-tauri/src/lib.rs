// src-tauri/src/lib.rs
// All backend logic: DB, tray, global shortcut, commands, deadline notifications

use chrono::NaiveDateTime;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

// ─── Data Model ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: String,   // "Low" | "Medium" | "High"
    pub progress: i64,      // 0-100
    pub deadline: Option<String>, // "YYYY-MM-DDTHH:MM" or None
    pub linked_paths: String,     // JSON array string e.g. '["C:\\path\\one"]'
    pub completed: bool,
    pub created_at: String, // ISO datetime string
}

// ─── App State ───────────────────────────────────────────────────────────────

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Prevents focus-loss hiding while a native dialog is open
    pub dialog_open: Mutex<bool>,
    /// Current shortcut modifier/key (to allow re-registration)
    pub shortcut_ctrl: Mutex<bool>,
    pub shortcut_shift: Mutex<bool>,
    pub shortcut_alt: Mutex<bool>,
    pub shortcut_key: Mutex<String>,
    /// Task IDs already notified this session (prevents spam)
    pub notified: Mutex<HashSet<String>>,
}

// ─── Database ────────────────────────────────────────────────────────────────

fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            description  TEXT DEFAULT '',
            priority     TEXT DEFAULT 'Medium',
            progress     INTEGER DEFAULT 0,
            deadline     TEXT,
            linked_paths TEXT DEFAULT '[]',
            completed    INTEGER DEFAULT 0,
            created_at   TEXT NOT NULL
        )",
    )
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, priority, progress, deadline,
                    linked_paths, completed, created_at
             FROM tasks ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let tasks = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                priority: row.get(3)?,
                progress: row.get(4)?,
                deadline: row.get(5)?,
                linked_paths: row.get(6)?,
                completed: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tasks)
}

#[tauri::command]
fn create_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tasks
            (id, title, description, priority, progress, deadline, linked_paths, completed, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            task.id,
            task.title,
            task.description,
            task.priority,
            task.progress,
            task.deadline,
            task.linked_paths,
            task.completed as i64,
            task.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tasks
         SET title=?1, description=?2, priority=?3, progress=?4,
             deadline=?5, linked_paths=?6, completed=?7
         WHERE id=?8",
        params![
            task.title,
            task.description,
            task.priority,
            task.progress,
            task.deadline,
            task.linked_paths,
            task.completed as i64,
            task.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    // Clean up notified set for deleted task
    let mut notified = state.notified.lock().map_err(|e| e.to_string())?;
    notified.remove(&id);
    Ok(())
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_autostart() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") {
        key.get_value::<String, _>("ToDoWidget").is_ok()
    } else {
        false
    }
}

#[tauri::command]
fn set_autostart(enabled: bool, exe_path: String) -> Result<(), String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_SET_VALUE},
        RegKey,
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_SET_VALUE,
        )
        .map_err(|e| e.to_string())?;

    if enabled {
        key.set_value("ToDoWidget", &exe_path)
            .map_err(|e| e.to_string())?;
    } else {
        let _ = key.delete_value("ToDoWidget");
    }
    Ok(())
}

#[tauri::command]
fn update_shortcut(
    app: tauri::AppHandle,
    state: State<AppState>,
    ctrl: bool,
    shift: bool,
    alt: bool,
    key: String,
) -> Result<(), String> {
    // Unregister old shortcut
    let old_ctrl = *state.shortcut_ctrl.lock().unwrap();
    let old_shift = *state.shortcut_shift.lock().unwrap();
    let old_alt = *state.shortcut_alt.lock().unwrap();
    let old_key = state.shortcut_key.lock().unwrap().clone();

    if let Ok(old) = make_shortcut(old_ctrl, old_shift, old_alt, &old_key) {
        let _ = app.global_shortcut().unregister(old);
    }

    // Register new shortcut
    let new_shortcut = make_shortcut(ctrl, shift, alt, &key)?;
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| e.to_string())?;

    // Persist new shortcut config
    *state.shortcut_ctrl.lock().unwrap() = ctrl;
    *state.shortcut_shift.lock().unwrap() = shift;
    *state.shortcut_alt.lock().unwrap() = alt;
    *state.shortcut_key.lock().unwrap() = key;

    Ok(())
}

/// Called by JS before/after opening a native file picker dialog
/// to prevent the window from hiding while the dialog is in use.
#[tauri::command]
fn set_dialog_open(state: State<AppState>, open: bool) {
    *state.dialog_open.lock().unwrap() = open;
}

// ─── Shortcut Helpers ────────────────────────────────────────────────────────

fn make_shortcut(ctrl: bool, shift: bool, alt: bool, key: &str) -> Result<Shortcut, String> {
    let code = key_to_code(key)?;
    let mut mods = Modifiers::empty();
    if ctrl  { mods |= Modifiers::CONTROL; }
    if shift { mods |= Modifiers::SHIFT;   }
    if alt   { mods |= Modifiers::ALT;     }
    let mods_opt = if mods.is_empty() { None } else { Some(mods) };
    Ok(Shortcut::new(mods_opt, code))
}

fn key_to_code(key: &str) -> Result<Code, String> {
    Ok(match key {
        "Space" => Code::Space,
        "F1"  => Code::F1,  "F2"  => Code::F2,  "F3"  => Code::F3,
        "F4"  => Code::F4,  "F5"  => Code::F5,  "F6"  => Code::F6,
        "F7"  => Code::F7,  "F8"  => Code::F8,  "F9"  => Code::F9,
        "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
        "A" => Code::KeyA, "B" => Code::KeyB, "C" => Code::KeyC,
        "D" => Code::KeyD, "E" => Code::KeyE, "F" => Code::KeyF,
        "G" => Code::KeyG, "H" => Code::KeyH, "I" => Code::KeyI,
        "J" => Code::KeyJ, "K" => Code::KeyK, "L" => Code::KeyL,
        "M" => Code::KeyM, "N" => Code::KeyN, "O" => Code::KeyO,
        "P" => Code::KeyP, "Q" => Code::KeyQ, "R" => Code::KeyR,
        "S" => Code::KeyS, "T" => Code::KeyT, "U" => Code::KeyU,
        "V" => Code::KeyV, "W" => Code::KeyW, "X" => Code::KeyX,
        "Y" => Code::KeyY, "Z" => Code::KeyZ,
        _ => return Err(format!("Unsupported key: {key}")),
    })
}

// ─── Window Management ───────────────────────────────────────────────────────

/// Positions the window at bottom-right of primary monitor.
fn position_window_right(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Use current_monitor (where mouse cursor is) as fallback to primary_monitor
        let monitor = window
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| window.current_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let screen = monitor.size();
            let win_size = window.outer_size().unwrap_or_default();
            let scale = monitor.scale_factor();
            let margin_x = (16.0 * scale) as i32;
            let margin_y = (56.0 * scale) as i32; // Leave space above Windows taskbar

            let x = screen.width as i32 - win_size.width as i32 - margin_x;
            let y = screen.height as i32 - win_size.height as i32 - margin_y;

            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_window_right(app);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

// ─── Deadline Checker ────────────────────────────────────────────────────────

fn start_deadline_checker(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Wait 10 seconds before first check to let app fully start
        std::thread::sleep(std::time::Duration::from_secs(10));
        loop {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(conn) = state.db.lock() {
                    check_deadlines(&app, &conn, &state);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

fn check_deadlines(app: &tauri::AppHandle, conn: &Connection, state: &AppState) {
    use tauri_plugin_notification::NotificationExt;

    let now = chrono::Local::now().naive_local();

    let mut stmt = match conn.prepare(
        "SELECT id, title, deadline FROM tasks WHERE completed=0 AND deadline IS NOT NULL",
    ) {
        Ok(s) => s,
        Err(_) => return,
    };

    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut notified = state.notified.lock().unwrap();

    for (id, title, deadline_str) in rows {
        if let Ok(deadline) =
            NaiveDateTime::parse_from_str(&deadline_str, "%Y-%m-%dT%H:%M")
        {
            let diff_secs = (deadline - now).num_seconds();
            let notify_key_overdue = format!("{id}_overdue");
            let notify_key_soon = format!("{id}_soon");

            if diff_secs < 0 && !notified.contains(&notify_key_overdue) {
                // Task is overdue
                let _ = app
                    .notification()
                    .builder()
                    .title("⚠️ Task Overdue!")
                    .body(&format!("\"{}\" has passed its deadline.", title))
                    .show();
                notified.insert(notify_key_overdue);
            } else if diff_secs >= 0 && diff_secs <= 3600 && !notified.contains(&notify_key_soon) {
                // Task is due within the next hour
                let mins = diff_secs / 60;
                let _ = app
                    .notification()
                    .builder()
                    .title("⏰ Task Due Soon!")
                    .body(&format!("\"{}\" is due in {} minutes.", title, mins))
                    .show();
                notified.insert(notify_key_soon);
            }
        }
    }
}

// ─── App Entry Point ─────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ── 1. Initialize SQLite database ─────────────────────────────
            let db_path = app
                .path()
                .app_data_dir()
                .expect("Could not resolve app data dir")
                .join("todos.db");

            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            let conn = Connection::open(&db_path).expect("Failed to open SQLite database");
            init_db(&conn).expect("Failed to initialize database schema");

            // ── 2. Manage shared app state ────────────────────────────────
            app.manage(AppState {
                db: Mutex::new(conn),
                dialog_open: Mutex::new(false),
                shortcut_ctrl: Mutex::new(true),
                shortcut_shift: Mutex::new(true),
                shortcut_alt: Mutex::new(false),
                shortcut_key: Mutex::new("Space".to_string()),
                notified: Mutex::new(HashSet::new()),
            });

            // ── 3. System tray ────────────────────────────────────────────
            let show_item =
                MenuItem::with_id(app, "show", "Show Widget", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("To-Do Widget  |  Ctrl+Shift+Space")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        position_window_right(app);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon → toggle widget
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // ── 4. Register default global shortcut (Ctrl+Shift+Space) ────
            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::Space,
            );
            app.global_shortcut().register(shortcut)?;

            // ── 5. Pre-position window before first show ──────────────────
            position_window_right(app.handle());

            // ── 6. Background deadline notification checker ───────────────
            start_deadline_checker(app.handle().clone());

            Ok(())
        })
        // Hide when window loses focus (click-outside behavior).
        // Uses a short delay + re-check to avoid hiding during native dialogs.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let app = window.app_handle().clone();
                let window = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    let is_dialog_open = app
                        .try_state::<AppState>()
                        .map(|s| *s.dialog_open.lock().unwrap())
                        .unwrap_or(false);
                    if !is_dialog_open && !window.is_focused().unwrap_or(true) {
                        let _ = window.hide();
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            create_task,
            update_task,
            delete_task,
            open_in_explorer,
            get_autostart,
            set_autostart,
            update_shortcut,
            set_dialog_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
