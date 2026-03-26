/**
 * App Entry Point
 * Plataforma PFO — GSE v5.0
 *
 * Initializes all modules and orchestrates the application.
 */
import { state } from './state.js';
import { initAuth, getCurrentUser } from './auth.js';
import { initRouter, navigateTo, onNavigate } from './router.js';
import { loadPlatformData, refreshData } from './services/github.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCiclos } from './pages/ciclos.js';
import { renderDre } from './pages/dre.js';
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
  console.log('[App] Plataforma PFO v5.0 — Iniciando...');

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
  setStatusPill('Carregando dados...', 'warn');
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
  // Inline section-action links with data-page
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
      btn.textContent = '\u21bb Atualizando...';
      setStatusPill('Atualizando dados...', 'warn');
      try {
        await refreshData();
        renderCurrentPage();
        showToast('Dados atualizados com sucesso!', 'success');
      } catch (err) {
        showToast('Erro ao atualizar: ' + err.message, 'error');
        showErrorBanner('Erro ao atualizar dados. Verifique a conexão e tente novamente.');
      }
      btn.textContent = '\u21bb Atualizar';
      btn.disabled = false;
    });
  }
}

/**
 * Load initial platform data with retries.
 */
async function loadInitialData() {
  hideErrorBanner();
  try {
    const data = await loadPlatformData();
    const pfoCount = data.pfos?.length || 0;
    const ccCount = Object.keys(data.centros_custo || {}).length;
    console.log('[App] Data loaded successfully: ' + pfoCount + ' PFOs, ' + ccCount + ' centros');
    renderCurrentPage();
    if (pfoCount === 0 && ccCount === 0) {
      setStatusPill('Sem dados no ciclo', 'warn');
      showToast('Dados carregados — nenhum PFO encontrado no ciclo atual.', 'warning');
    } else {
      showToast('Dados carregados: ' + pfoCount + ' PFOs, ' + ccCount + ' centros.', 'success');
    }
  } catch (error) {
    console.error('[App] Failed to load data:', error);
    setStatusPill('Erro ao carregar', 'crit');
    showErrorBanner(
      'Não foi possível carregar os dados da plataforma. ' +
      'Erro: ' + error.message + '. ' +
      'Verifique se as variáveis de ambiente GITHUB_TOKEN e GITHUB_REPO estão configuradas no Vercel.'
    );
  }
}

/**
 * Handle page-specific rendering on navigation.
 */
function handlePageNavigation(pageName) {
  if (!state.data) return;
  const renderers = {
    dashboard: renderDashboard,
    dre: renderDre,
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

/**
 * Show a prominent error banner at the top of the page.
 */
function showErrorBanner(message) {
  let banner = document.getElementById('error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.style.cssText = 'background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);'
      + 'color:#f8a1a1;padding:14px 20px;margin:14px 28px 0;border-radius:8px;'
      + 'font-size:13px;line-height:1.6;display:flex;align-items:flex-start;gap:10px;';
    const mainContent = document.querySelector('.main');
    const topbar = document.querySelector('.topbar');
    if (mainContent && topbar) {
      topbar.insertAdjacentElement('afterend', banner);
    }
  }
  banner.innerHTML = '<span style="font-size:16px;flex-shrink:0">\u26a0</span> <div>'
    + '<strong>Erro ao carregar dados</strong><br>'
    + message + '<br>'
    + '<button onclick="this.closest(\'#error-banner\').remove();location.reload();"'
    + ' style="margin-top:8px;background:#f87171;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">'
    + '\u21bb Tentar novamente</button></div>';
  banner.style.display = 'flex';
}

/**
 * Hide the error banner.
 */
function hideErrorBanner() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.style.display = 'none';
}

// Boot!
init();
