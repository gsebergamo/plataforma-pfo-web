/**
 * SPA Router
 * Plataforma PFO — GSE
 *
 * Simple client-side router with hash-based navigation.
 * Preserves the original showPage() behavior while adding URL support.
 */

const PAGE_TITLES = {
  dashboard: 'Dashboard Executivo',
  ciclos: 'Ciclos & Status',
  upload: 'Upload de PFO',
  aprovacoes: 'Aprovações',
  centros: 'Centros de Custo',
  agente: 'Agente IA',
  relatorios: 'Relatórios',
};

let _currentPage = 'dashboard';
let _onNavigateCallbacks = [];

/**
 * Initialize the router.
 * Sets up hash-based navigation and handles initial route.
 */
export function initRouter() {
  // Handle browser back/forward
  window.addEventListener('hashchange', () => {
    const page = getPageFromHash();
    if (page && page !== _currentPage) {
      navigateTo(page, false);
    }
  });

  // Set initial page from hash or default
  const initial = getPageFromHash() || 'dashboard';
  navigateTo(initial, false);
}

/**
 * Navigate to a page.
 * @param {string} pageName
 * @param {boolean} updateHash - whether to update URL hash
 */
export function navigateTo(pageName, updateHash = true) {
  if (!PAGE_TITLES[pageName]) return;

  _currentPage = pageName;

  // Update URL hash
  if (updateHash) {
    window.location.hash = pageName === 'dashboard' ? '' : pageName;
  }

  // Hide all pages, show target
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageName);
  if (page) {
    page.classList.add('active');
    // Re-trigger fade-in animation
    page.classList.remove('fade-in');
    void page.offsetWidth; // force reflow
    page.classList.add('fade-in');
  }

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach((item) => {
    const onclick = item.dataset.page;
    item.classList.toggle('active', onclick === pageName);
  });

  // Update topbar title
  const title = document.getElementById('page-title');
  if (title) title.textContent = PAGE_TITLES[pageName] || pageName;

  // Notify listeners
  _onNavigateCallbacks.forEach((fn) => fn(pageName));
}

/**
 * Subscribe to navigation events.
 * @param {Function} callback - Called with (pageName) on navigation
 * @returns {Function} Unsubscribe function
 */
export function onNavigate(callback) {
  _onNavigateCallbacks.push(callback);
  return () => {
    _onNavigateCallbacks = _onNavigateCallbacks.filter((c) => c !== callback);
  };
}

/**
 * Get current page name.
 * @returns {string}
 */
export function getCurrentPage() {
  return _currentPage;
}

/**
 * Parse page name from URL hash.
 * @returns {string|null}
 */
function getPageFromHash() {
  const hash = window.location.hash.replace('#', '');
  return PAGE_TITLES[hash] ? hash : null;
}
