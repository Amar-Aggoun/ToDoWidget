/**
 * To-Do Widget — Main Application Logic
 * Handles all UI interactions, state management, and Tauri IPC calls.
 */

import { invoke } from '@tauri-apps/api/core';
import { open }   from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ─── State ────────────────────────────────────────────────────────────────────

const appWindow = getCurrentWindow();

let state = {
  tasks:      [],
  filter:     'all',      // 'all'|'active'|'completed'|'high'|'medium'|'low'
  sort:       'created_at', // 'created_at'|'deadline'|'priority'|'progress'
  editingId:  null,       // task id being edited, null = adding new
  linkedPaths: [],        // paths collected in the modal
  expandedIds: new Set(), // task ids currently expanded
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadTasks();
  bindStaticEvents();
  bindWindowEvents();
});

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadTasks() {
  try {
    state.tasks = await invoke('get_tasks');
  } catch (err) {
    console.error('get_tasks failed:', err);
    state.tasks = [];
  }
  renderAll();
}

// ─── Filtering & Sorting ──────────────────────────────────────────────────────

function getDisplayTasks() {
  let list = [...state.tasks];

  // Filter
  switch (state.filter) {
    case 'active':    list = list.filter(t => !t.completed); break;
    case 'completed': list = list.filter(t =>  t.completed); break;
    case 'high':      list = list.filter(t => t.priority === 'High');   break;
    case 'medium':    list = list.filter(t => t.priority === 'Medium'); break;
    case 'low':       list = list.filter(t => t.priority === 'Low');    break;
  }

  // Sort
  const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
  list.sort((a, b) => {
    switch (state.sort) {
      case 'deadline':
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      case 'progress':
        return b.progress - a.progress;
      default: // created_at descending
        return b.created_at.localeCompare(a.created_at);
    }
  });

  return list;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderAll() {
  renderSummary();
  renderTaskList();
}

function renderSummary() {
  const total  = state.tasks.length;
  const done   = state.tasks.filter(t => t.completed).length;
  const active = total - done;
  const el = document.getElementById('task-summary');
  if (total === 0) {
    el.textContent = '';
    return;
  }
  el.textContent = `${active} active · ${done} done · ${total} total`;
}

function renderTaskList() {
  const list    = document.getElementById('task-list');
  const display = getDisplayTasks();

  if (display.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>${state.tasks.length === 0
          ? 'No tasks yet.<br/>Press <strong>+&nbsp;Add</strong> to get started!'
          : 'No tasks match the current filter.'
        }</p>
      </div>`;
    return;
  }

  list.innerHTML = display.map(task => renderCard(task)).join('');

  // Attach events to rendered cards
  display.forEach(task => attachCardEvents(task.id));
}

// ─── Priority helpers ─────────────────────────────────────────────────────────

const PRIORITY_COLORS = {
  High:   '#EF4444',
  Medium: '#F59E0B',
  Low:    '#3B82F6',
};

function priorityColor(p) {
  return PRIORITY_COLORS[p] ?? PRIORITY_COLORS.Medium;
}

// ─── Deadline badge ───────────────────────────────────────────────────────────

function deadlineBadge(deadline) {
  if (!deadline) return '';
  const d    = new Date(deadline);
  const now  = new Date();
  const diff = d - now; // ms

  let text, cls;
  if (diff < 0) {
    text = '⚠ Overdue';
    cls  = 'badge-overdue';
  } else if (diff < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diff / 60000));
    text = `⏰ ${mins}m left`;
    cls  = 'badge-urgent';
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hrs = Math.floor(diff / 3600000);
    text = `${hrs}h left`;
    cls  = 'badge-warning';
  } else {
    const days = Math.floor(diff / 86400000);
    text = days === 1 ? 'Tomorrow' : `${days}d left`;
    cls  = 'badge-normal';
  }
  return `<span class="badge ${cls}">${text}</span>`;
}

// ─── Task Card HTML ───────────────────────────────────────────────────────────

function renderCard(task) {
  const color    = priorityColor(task.priority);
  const badge    = deadlineBadge(task.deadline);
  const paths    = safeParsePaths(task.linked_paths);
  const expanded = state.expandedIds.has(task.id);

  const pathsHtml = paths.length > 0
    ? `<div class="linked-paths-section">
         <p class="paths-label">📁 Linked Folders</p>
         ${paths.map(p => `
           <div class="path-item" data-open-path="${esc(p)}">
             <span class="path-text">${esc(p)}</span>
             <span class="path-open">Open ↗</span>
           </div>
         `).join('')}
       </div>`
    : '';

  const expandedHtml = (task.description || paths.length > 0)
    ? `<div class="task-expanded ${expanded ? '' : 'hidden'}" id="exp-${task.id}">
         ${task.description ? `<p class="task-description">${esc(task.description)}</p>` : ''}
         ${pathsHtml}
       </div>`
    : '';

  return `
    <div class="task-card ${task.completed ? 'completed' : ''}"
         data-id="${task.id}"
         style="border-left-color: ${color};">

      <div class="task-header" data-toggle="${task.id}">
        <div class="task-left">
          <input type="checkbox" class="task-checkbox"
                 id="chk-${task.id}"
                 ${task.completed ? 'checked' : ''}
                 data-complete="${task.id}" />
          <span class="task-title ${task.completed ? 'done' : ''}">${esc(task.title)}</span>
        </div>
        <div class="task-right">
          ${badge}
          <button class="card-btn" data-edit="${task.id}" title="Edit">✏️</button>
          <button class="card-btn delete" data-delete="${task.id}" title="Delete">🗑️</button>
        </div>
      </div>

      <div class="progress-container">
        <div class="progress-track">
          <div class="progress-fill"
               style="width:${task.progress}%; background:${color};"></div>
        </div>
        <span class="progress-label">${task.progress}%</span>
      </div>

      ${expandedHtml}
    </div>`;
}

// ─── Card Event Binding ───────────────────────────────────────────────────────

function attachCardEvents(id) {
  // Toggle expand on header click (but not on interactive elements)
  const header = document.querySelector(`[data-toggle="${id}"]`);
  if (header) {
    header.addEventListener('click', e => {
      if (e.target.closest('[data-complete],[data-edit],[data-delete]')) return;
      toggleExpand(id);
    });
  }

  // Checkbox: toggle completion
  const chk = document.querySelector(`[data-complete="${id}"]`);
  if (chk) {
    chk.addEventListener('change', e => {
      e.stopPropagation();
      handleToggleComplete(id, e.target.checked);
    });
  }

  // Edit button
  const editBtn = document.querySelector(`[data-edit="${id}"]`);
  if (editBtn) {
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(id);
    });
  }

  // Delete button
  const delBtn = document.querySelector(`[data-delete="${id}"]`);
  if (delBtn) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      handleDelete(id);
    });
  }

  // Open folder links
  document.querySelectorAll(`[data-id="${id}"] [data-open-path]`).forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      invoke('open_in_explorer', { path: el.dataset.openPath }).catch(console.error);
    });
  });
}

function toggleExpand(id) {
  const expEl = document.getElementById(`exp-${id}`);
  if (!expEl) return; // no expandable content
  if (state.expandedIds.has(id)) {
    state.expandedIds.delete(id);
    expEl.classList.add('hidden');
  } else {
    state.expandedIds.add(id);
    expEl.classList.remove('hidden');
  }
}

// ─── CRUD Handlers ────────────────────────────────────────────────────────────

async function handleToggleComplete(id, completed) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const updated = { ...task, completed, progress: completed ? 100 : task.progress };
  try {
    await invoke('update_task', { task: updated });
    Object.assign(task, updated);
    renderAll();
  } catch (err) {
    console.error('update_task failed:', err);
  }
}

async function handleDelete(id) {
  try {
    await invoke('delete_task', { id });
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.expandedIds.delete(id);
    renderAll();
  } catch (err) {
    console.error('delete_task failed:', err);
  }
}

// ─── Modal: Add / Edit ────────────────────────────────────────────────────────

function openModal(editId = null) {
  state.editingId   = editId;
  state.linkedPaths = [];

  const form       = document.getElementById('task-form');
  const titleEl    = document.getElementById('modal-title');
  const overlay    = document.getElementById('modal-overlay');

  form.reset();
  document.getElementById('progress-val').textContent = '0';

  if (editId) {
    const task = state.tasks.find(t => t.id === editId);
    if (!task) return;
    titleEl.textContent = 'Edit Task';
    document.getElementById('f-title').value      = task.title;
    document.getElementById('f-desc').value       = task.description || '';
    document.getElementById('f-priority').value   = task.priority;
    document.getElementById('f-progress').value   = task.progress;
    document.getElementById('progress-val').textContent = task.progress;
    document.getElementById('f-deadline').value   = task.deadline ?? '';
    state.linkedPaths = safeParsePaths(task.linked_paths);
  } else {
    titleEl.textContent = 'Add Task';
  }

  renderModalPaths();
  overlay.classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  state.editingId   = null;
  state.linkedPaths = [];
}

function renderModalPaths() {
  const container = document.getElementById('linked-paths-list');
  if (state.linkedPaths.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = state.linkedPaths.map((p, i) => `
    <div class="modal-path-item">
      <span class="modal-path-text">${esc(p)}</span>
      <button type="button" class="modal-path-remove" data-remove-idx="${i}">✕</button>
    </div>`).join('');

  container.querySelectorAll('[data-remove-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.linkedPaths.splice(Number(btn.dataset.removeIdx), 1);
      renderModalPaths();
    });
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('f-title').value.trim();
  if (!title) return;

  const task = {
    id:           state.editingId ?? crypto.randomUUID(),
    title,
    description:  document.getElementById('f-desc').value.trim(),
    priority:     document.getElementById('f-priority').value,
    progress:     Number(document.getElementById('f-progress').value),
    deadline:     document.getElementById('f-deadline').value || null,
    linked_paths: JSON.stringify(state.linkedPaths),
    completed:    false,
    created_at:   new Date().toISOString(),
  };

  try {
    if (state.editingId) {
      // Preserve original created_at & completed status
      const original = state.tasks.find(t => t.id === state.editingId);
      task.created_at = original?.created_at ?? task.created_at;
      task.completed  = original?.completed  ?? false;
      await invoke('update_task', { task });
      const idx = state.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) state.tasks[idx] = task;
    } else {
      await invoke('create_task', { task });
      state.tasks.unshift(task);
    }
    closeModal();
    renderAll();
  } catch (err) {
    console.error('save task failed:', err);
  }
}

// ─── Folder Picker ────────────────────────────────────────────────────────────

async function handlePickFolder() {
  try {
    // Notify Rust to suppress focus-loss hiding
    await invoke('set_dialog_open', { open: true });
    const selected = await open({ directory: true, multiple: false });
    if (selected && !state.linkedPaths.includes(selected)) {
      state.linkedPaths.push(selected);
      renderModalPaths();
    }
  } catch (err) {
    // User cancelled — that's fine
  } finally {
    await invoke('set_dialog_open', { open: false });
    await appWindow.setFocus();
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function openSettings() {
  document.getElementById('settings-overlay').classList.remove('hidden');
  // Load current auto-start state
  try {
    const enabled = await invoke('get_autostart');
    const toggle  = document.getElementById('toggle-autostart');
    toggle.checked = enabled;
    document.getElementById('autostart-label').textContent = enabled ? 'Enabled' : 'Disabled';
  } catch (err) {
    console.error('get_autostart failed:', err);
  }
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.add('hidden');
  document.getElementById('shortcut-feedback').classList.add('hidden');
}

async function handleApplyShortcut() {
  const ctrl  = document.getElementById('hk-ctrl').checked;
  const shift = document.getElementById('hk-shift').checked;
  const alt   = document.getElementById('hk-alt').checked;
  const key   = document.getElementById('hk-key').value;
  const fb    = document.getElementById('shortcut-feedback');

  if (!ctrl && !shift && !alt) {
    showFeedback(fb, 'Please select at least one modifier key (Ctrl, Shift, or Alt).', 'error');
    return;
  }

  try {
    await invoke('update_shortcut', { ctrl, shift, alt, key });
    const parts = [];
    if (ctrl)  parts.push('Ctrl');
    if (shift) parts.push('Shift');
    if (alt)   parts.push('Alt');
    parts.push(key);
    showFeedback(fb, `✓ Shortcut set to: ${parts.join('+')}`, 'success');
  } catch (err) {
    showFeedback(fb, `Failed: ${err}`, 'error');
  }
}

async function handleAutoStartToggle(e) {
  const enabled = e.target.checked;
  document.getElementById('autostart-label').textContent = enabled ? 'Enabled' : 'Disabled';
  try {
    // Get current exe path from Tauri environment
    const exePath = window.__TAURI_INTERNALS__?.metadata?.currentExe ?? '';
    await invoke('set_autostart', { enabled, exePath });
  } catch (err) {
    console.error('set_autostart failed:', err);
    e.target.checked = !enabled; // revert on error
    document.getElementById('autostart-label').textContent = !enabled ? 'Enabled' : 'Disabled';
  }
}

function showFeedback(el, msg, type) {
  el.textContent = msg;
  el.className = `settings-feedback ${type}`;
}

// ─── Window Animation & Keyboard ──────────────────────────────────────────────

function bindWindowEvents() {
  // Esc → hide widget (with slide-out animation)
  document.addEventListener('keydown', async e => {
    if (e.key === 'Escape') {
      // Close open modals first
      const modalOpen    = !document.getElementById('modal-overlay').classList.contains('hidden');
      const settingsOpen = !document.getElementById('settings-overlay').classList.contains('hidden');
      if (modalOpen) {
        closeModal();
      } else if (settingsOpen) {
        closeSettings();
      } else {
        await hideWidget();
      }
    }
  });

  // Re-run slide-in animation each time window is shown
  appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      const app = document.getElementById('app');
      app.classList.remove('slide-out');
      void app.offsetWidth; // force reflow to restart animation
      app.classList.remove('slide-out');
      app.style.animation = 'none';
      void app.offsetWidth;
      app.style.animation = '';
    }
  });
}

async function hideWidget() {
  const app = document.getElementById('app');
  app.classList.add('slide-out');
  await delay(240);
  await appWindow.hide();
  app.classList.remove('slide-out');
}

// ─── Static Event Binding ─────────────────────────────────────────────────────

function bindStaticEvents() {
  // Header buttons
  document.getElementById('btn-add').addEventListener('click', () => openModal());
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-filter').addEventListener('click', () => {
    document.getElementById('filter-bar').classList.toggle('hidden');
  });

  // Filter / Sort selects
  document.getElementById('sel-filter').addEventListener('change', e => {
    state.filter = e.target.value;
    renderAll();
  });
  document.getElementById('sel-sort').addEventListener('change', e => {
    state.sort = e.target.value;
    renderAll();
  });

  // Modal
  document.getElementById('task-form').addEventListener('submit', handleFormSubmit);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
  document.getElementById('btn-pick-folder').addEventListener('click', handlePickFolder);

  // Progress slider label update
  document.getElementById('f-progress').addEventListener('input', e => {
    document.getElementById('progress-val').textContent = e.target.value;
  });

  // Settings
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('btn-apply-shortcut').addEventListener('click', handleApplyShortcut);
  document.getElementById('toggle-autostart').addEventListener('change', handleAutoStartToggle);

  // Close modals when clicking the dark overlay (outside the modal box)
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Safely parse a JSON paths string, returning [] on failure */
function safeParsePaths(str) {
  try {
    const parsed = JSON.parse(str || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Escape HTML to prevent XSS in innerHTML */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Simple promise-based delay */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
