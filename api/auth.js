const crypto = require('crypto');
const https = require('https');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'pfo-platform-2026-secret';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Usuarios padrao — fallback caso o GitHub JSON nao tenha a chave 'usuarios'.
 */
const USUARIOS_DEFAULT = {
        'paulo.bergamo': { senha: 'gse2025!', nome: 'Paulo Bergamo', email: 'paulo@gse.com.br', alcada: 'admin', centros_custo: ['*'] },
        'validador':     { senha: 'valid2025!', nome: 'Validador GSE', email: '', alcada: 'validador', centros_custo: ['*'] },
        'gestor':        { senha: 'gestor2025!', nome: 'Gestor GSE', email: '', alcada: 'gestor', centros_custo: ['*'] },
};

// ---------------------------------------------------------------------------
// GitHub helpers — read / write dados/plataforma.json
// ---------------------------------------------------------------------------
function ghRequest(host, path, method, token, body, accept) {
        return new Promise((resolve, reject) => {
                  const payload = body ? JSON.stringify(body) : null;
                  const opts = {
                              hostname: host, path, method,
                              headers: {
                                            Authorization: 'token ' + token,
                                            Accept: accept || 'application/json',
                                            'User-Agent': 'PFO-Platform/5.0',
                                            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                              },
                  };
                  const req = https.request(opts, (res) => {
                              let data = '';
                              res.on('data', c => data += c);
                              res.on('end', () => {
                                            if (res.statusCode >= 400) return reject(new Error('GitHub ' + res.statusCode + ': ' + data.substring(0, 200)));
                                            try { resolve(JSON.parse(data)); } catch { resolve(data); }
                              });
                  });
                  req.on('error', reject);
                  req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
                  if (payload) req.write(payload);
                  req.end();
        });
}

async function lerJSON() {
        const ghToken = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';
        if (!ghToken) throw new Error('GITHUB_TOKEN nao configurado');
        const meta = await ghRequest('api.github.com', '/repos/' + repo + '/contents/dados/plataforma.json', 'GET', ghToken);
        if (!meta || !meta.sha) throw new Error('plataforma.json nao encontrado');
        const raw = await ghRequest('api.github.com', '/repos/' + repo + '/git/blobs/' + meta.sha, 'GET', ghToken, null, 'application/vnd.github.raw+json');
        return { data: raw, sha: meta.sha };
}

async function salvarJSON(data, sha, message) {
        const ghToken = process.env.GITHUB_TOKEN;
        const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';
        if (!ghToken) throw new Error('GITHUB_TOKEN nao configurado');
        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        return ghRequest('api.github.com', '/repos/' + repo + '/contents/dados/plataforma.json', 'PUT', ghToken, {
                  message: message || '[plataforma] update usuarios',
                  content,
                  sha,
        });
}

// ---------------------------------------------------------------------------
// getUsuarios — merge: USUARIOS_DEFAULT < GitHub JSON < PFO_USERS env
// ---------------------------------------------------------------------------
async function getUsuariosFromGH() {
        try {
                  const { data, sha } = await lerJSON();
                  return { usuarios: data.usuarios || {}, allData: data, sha };
        } catch (e) {
                  console.warn('[auth] Falha ao ler GitHub JSON:', e.message);
                  return { usuarios: {}, allData: null, sha: null };
        }
}

function getUsuarios() {
        // Sync version — only defaults + env var (used for quick checks)
  const merged = {};
        for (const [u, info] of Object.entries(USUARIOS_DEFAULT)) {
                  merged[u] = { ...info };
        }
        if (process.env.PFO_USERS) {
                  try {
                              const salvos = JSON.parse(process.env.PFO_USERS);
                              for (const [u, info] of Object.entries(salvos)) {
                                            if (merged[u]) Object.assign(merged[u], info);
                                            else merged[u] = { ...info };
                              }
                  } catch (e) { console.error('[auth] PFO_USERS parse error:', e.message); }
        }
        return merged;
}

async function getUsuariosAsync() {
        // Async version — reads from GitHub JSON (source of truth)
  const merged = {};
        for (const [u, info] of Object.entries(USUARIOS_DEFAULT)) {
                  merged[u] = { ...info };
        }
        // GitHub JSON overrides defaults
  const { usuarios: ghUsers, allData, sha } = await getUsuariosFromGH();
        for (const [u, info] of Object.entries(ghUsers)) {
                  if (merged[u]) Object.assign(merged[u], info);
                  else merged[u] = { ...info };
        }
        // PFO_USERS env var overrides everything
  if (process.env.PFO_USERS) {
            try {
                        const salvos = JSON.parse(process.env.PFO_USERS);
                        for (const [u, info] of Object.entries(salvos)) {
                                      if (merged[u]) Object.assign(merged[u], info);
                                      else merged[u] = { ...info };
                        }
            } catch (e) { console.error('[auth] PFO_USERS parse error:', e.message); }
  }
        return { usuarios: merged, allData, sha };
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
function criarToken(usuario, nome, alcada, centros_custo) {
        const payload = { usuario, nome, alcada, centros_custo, exp: Date.now() + TOKEN_EXPIRY_MS };
        const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
        return data + '.' + sig;
}

function validarToken(token) {
        try {
                  const parts = token.split('.');
                  if (parts.length !== 2) return null;
                  const [data, sig] = parts;
                  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
                  if (sig !== expected) return null;
                  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
                  if (payload.exp < Date.now()) return null;
                  return payload;
        } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// POST /api/auth — Login
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        try {
                  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                  const { usuario, senha } = body;
                  if (!usuario || !senha) return res.status(400).json({ error: 'Usuario e senha sao obrigatorios.' });

          const { usuarios } = await getUsuariosAsync();
                  const user = usuarios[usuario.toLowerCase()];

          if (!user || user.senha !== senha) {
                      console.log('[auth] Login failed for:', usuario);
                      return res.status(401).json({ error: 'Usuario ou senha incorretos.' });
          }

          const token = criarToken(usuario.toLowerCase(), user.nome, user.alcada, user.centros_custo || '*');
                  console.log('[auth] Login OK:', usuario, '| alcada:', user.alcada);

          return res.status(200).json({
                      token,
                      usuario: usuario.toLowerCase(),
                      nome: user.nome,
                      alcada: user.alcada,
                      centros_custo: user.centros_custo || '*',
                      email: user.email || ''
          });
        } catch (err) {
                  console.error('[auth] Error:', err.message);
                  return res.status(500).json({ error: 'Erro interno na autenticacao.' });
        }
};

// Exports para uso em outros endpoints
module.exports.validarToken = validarToken;
module.exports.getUsuarios = getUsuarios;
module.exports.getUsuariosAsync = getUsuariosAsync;
module.exports.getUsuariosFromGH = getUsuariosFromGH;
module.exports.criarToken = criarToken;
module.exports.USUARIOS_DEFAULT = USUARIOS_DEFAULT;
module.exports.lerJSON = lerJSON;
module.exports.salvarJSON = salvarJSON;
