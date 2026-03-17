/**
 * App Entry Point
 * Plataforma PFO — GSE v5.0
 *
 * Initializes all modules and orchestrates the application.
 * This replaces the inline <script> in the old index.html.
 */

import { state } from './state.js';
import { initAuth, getCurrentUser } from './auth.js';
import { initRouter, navigateTo, onNavigate } from './router.js';
import { loadPlatformData, refreshData } from './services/github.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCiclos } from './pages/ciclos.js';
import { initUpload, renderUploads } from './pages/upload.js';
import { renderAprovacoes } from './pages/aprovacoes.js';
import { renderCentros, filterCentros } from './pages/centros.js';
import { initAgente } from './pages/agente.js';
import { initRelatorios } from './pages/relatorios.js';
import { showToast } from './components/ui.js';

/**
 * Boot the application.
 */
async function init() {
  // 1. Initialize auth
  initAuth();
  renderUserInfo();

  // 2. Set up navigation
  setupNavigation();
  initRouter();

  // 3. Initialize page-specific handlers
  initUpload();
  initAgente();
  initRelatorios();
  setupMobileMenu();
  setupSearchInput();
  setupRefreshButton();

  // 4. Listen to navigation events to render pages on demand
  onNavigate(handlePageNavigation);

  // 5. Load data
  await loadInitialData();
}

/**
 * Render user info in sidebar from auth module.
 */
function renderUserInfo() {
  const user = getCurrentUser();
  if (!user) return;

  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role;
  if (avatarEl) avatarEl.textContent = user.initials;
}

/**
 * Set up navigation click handlers (sidebar + inline links).
 */
function setupNavigation() {
  // Sidebar nav items
  document.querySelectorAll('.nav-item[data-page]').forEach((item) => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page) navigateTo(page);
      document.querySelector('.sidebar')?.classList.remove('open');
    });
  });

  // Inline section-action links with data-page (e.g., "ver detalhe →")
  document.querySelectorAll('[data-page]:not(.nav-item)').forEach((el) => {
    el.addEventListener('click', () => {
      const page = el.dataset.page;
      if (page) navigateTo(page);
    });
  });
}

/**
 * Mobile menu toggle.
 */
function setupMobileMenu() {
  const toggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== toggle
      ) {
        sidebar.classList.remove('open');
      }
    });
  }
}

/**
 * Set up centros de custo search input.
 */
function setupSearchInput() {
  const searchInput = document.getElementById('search-cc');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterCentros(e.target.value);
    });
  }
}

/**
 * Set up refresh data button.
 */
function setupRefreshButton() {
  const btn = document.getElementById('btn-refresh');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await refreshData();
        renderCurrentPage();
        showToast('Dados atualizados com sucesso!', 'success');
      } catch {
        showToast('Erro ao atualizar dados.', 'error');
      }
      btn.disabled = false;
    });
  }
}

/**
 * Load initial platform data.
 */
async function loadInitialData() {
  try {
    await loadPlatformData();
    renderDashboard();
    showToast('Dados carregados com sucesso!', 'success');
  } catch (error) {
    console.error('[App] Failed to load data:', error);
    setStatusPill('Erro ao carregar', 'crit');
  }
}

/**
 * Handle page-specific rendering on navigation.
 */
function handlePageNavigation(pageName) {
  if (!state.data) return;

  const renderers = {
    dashboard: renderDashboard,
    ciclos: renderCiclos,
    upload: renderUploads,
    aprovacoes: renderAprovacoes,
    centros: renderCentros,
  };

  const render = renderers[pageName];
  if (render) render();
}

/**
 * Re-render the current page.
 */
function renderCurrentPage() {
  const page = window.location.hash.replace('#', '') || 'dashboard';
  handlePageNavigation(page);
}

/**
 * Set the status pill in the topbar.
 */
function setStatusPill(text, type) {
  const pill = document.getElementById('status-pill');
  const textEl = document.getElementById('status-text');
  if (pill) pill.className = 'status-pill ' + type;
  if (textEl) textEl.textContent = text;
}

// Boot!
init();
