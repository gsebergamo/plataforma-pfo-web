/**
 * Auth Module — Plataforma PFO GSE
 * Real authentication via /api/auth endpoint.
 * Replaces static user with real login.
 */

let _currentUser = null;
let _token = null;
let _onAuthChangeCallbacks = [];

/**
 * Initialize auth — check for saved token in localStorage.
 */
export function initAuth() {
  const savedToken = localStorage.getItem('pfo_token');
  const savedUser = localStorage.getItem('pfo_user');

  if (savedToken && savedUser) {
    try {
      const [data] = savedToken.split('.');
      const payload = JSON.parse(atob(data.replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp && payload.exp > Date.now()) {
        _token = savedToken;
        _currentUser = JSON.parse(savedUser);
        _notifyAuthChange();
        return;
      }
    } catch (e) {
      console.warn('[Auth] Saved token invalid, clearing');
    }
    localStorage.removeItem('pfo_token');
    localStorage.removeItem('pfo_user');
  }

  _currentUser = null;
  _token = null;
  _notifyAuthChange();
}

/**
 * Login via /api/auth.
 */
export async function login(usuario, senha) {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Credenciais invalidas');
  }
  _token = data.token;
  _currentUser = {
    id: data.usuario,
    name: data.nome,
    initials: data.nome.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase(),
    role: (data.alcada || 'usuario').toUpperCase(),
    alcada: data.alcada,
    centros_custo: data.centros_custo || ['*'],
  };
  localStorage.setItem('pfo_token', _token);
  localStorage.setItem('pfo_user', JSON.stringify(_currentUser));
  _notifyAuthChange();
  return _currentUser;
}

/**
 * Logout — clear session.
 */
export function logout() {
  _currentUser = null;
  _token = null;
  localStorage.removeItem('pfo_token');
  localStorage.removeItem('pfo_user');
  _notifyAuthChange();
  const loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.style.display = 'flex';
  window.location.reload();
}

/**
 * Change password via /api/senha.
 */
export async function changePassword(senhaAtual, novaSenha) {
  if (!_token) throw new Error('Nao autenticado');
  const res = await fetch('/api/senha', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + _token,
    },
    body: JSON.stringify({ senha_atual: senhaAtual, nova_senha: novaSenha }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro ao alterar senha');
  return data;
}

/**
 * Get the current authenticated user.
 */
export function getCurrentUser() {
  return _currentUser;
}

/**
 * Get the auth token.
 */
export function getToken() {
  return _token;
}

/**
 * Check if a user is authenticated.
 */
export function isAuthenticated() {
  return _currentUser !== null && _token !== null;
}

/**
 * Check if the current user has a specific permission.
 */
export function hasPermission(permission) {
  if (!_currentUser) return false;
  if (_currentUser.alcada === 'admin') return true;
  const perms = {
    diretor: ['view', 'approve', 'admin'],
    validador: ['view', 'approve'],
    gestor: ['view', 'upload'],
    usuario: ['view'],
  };
  return (perms[_currentUser.alcada] || ['view']).includes(permission);
}

/**
 * Subscribe to auth state changes.
 */
export function onAuthChange(callback) {
  _onAuthChangeCallbacks.push(callback);
  return () => {
    _onAuthChangeCallbacks = _onAuthChangeCallbacks.filter((cb) => cb !== callback);
  };
}

function _notifyAuthChange() {
  _onAuthChangeCallbacks.forEach((cb) => cb(_currentUser));
}
