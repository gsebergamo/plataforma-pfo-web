/**
 * Auth / Identity Module
 * Plataforma PFO — GSE
 *
 * Abstraction layer for user identity.
 * Currently uses a static user profile — prepared for future auth integration.
 *
 * MIGRATION GUIDE:
 *   To add real auth, replace getCurrentUser() to fetch from your auth provider.
 *   All consumer code reads from this module, so the change is centralized.
 */

const DEFAULT_USER = {
  id: 'paulo.bergamo',
  name: 'Paulo Bergamo',
  initials: 'PB',
  role: 'DIRETOR',
  email: 'paulo.bergamo@gse.com.br',
  permissions: ['view', 'approve', 'admin'],
};

let _currentUser = null;
let _onAuthChangeCallbacks = [];

/**
 * Initialize the auth module.
 * In the future, this will handle token validation, session restore, etc.
 */
export function initAuth() {
  // Future: check localStorage for session, validate token, etc.
  _currentUser = { ...DEFAULT_USER };
  _notifyAuthChange();
}

/**
 * Get the current authenticated user.
 * @returns {Object|null}
 */
export function getCurrentUser() {
  return _currentUser;
}

/**
 * Check if a user is authenticated.
 * @returns {boolean}
 */
export function isAuthenticated() {
  return _currentUser !== null;
}

/**
 * Check if the current user has a specific permission.
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(permission) {
  if (!_currentUser) return false;
  return _currentUser.permissions.includes(permission);
}

/**
 * Subscribe to auth state changes.
 * @param {Function} callback
 * @returns {Function} unsubscribe function
 */
export function onAuthChange(callback) {
  _onAuthChangeCallbacks.push(callback);
  return () => {
    _onAuthChangeCallbacks = _onAuthChangeCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Logout — clears user session.
 * Future: will also clear tokens and redirect.
 */
export function logout() {
  _currentUser = null;
  _notifyAuthChange();
}

function _notifyAuthChange() {
  _onAuthChangeCallbacks.forEach((cb) => cb(_currentUser));
}
