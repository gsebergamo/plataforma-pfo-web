const crypto = require('crypto');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'pfo-platform-2026-secret';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Usuarios padrao — identicos ao app.py do Streamlit.
 * PFO_USERS env var (JSON) pode adicionar/sobrescrever.
 */
const USUARIOS_DEFAULT = {
    'paulo.bergamo': { senha: 'gse2025!', nome: 'Paulo Bergamo', alcada: 'admin', centros_custo: ['*'] },
    'validador':     { senha: 'valid2025!', nome: 'Validador GSE', alcada: 'validador', centros_custo: ['*'] },
    'gestor':        { senha: 'gestor2025!', nome: 'Gestor GSE', alcada: 'gestor', centros_custo: ['*'] },
    'dir.comercial': { senha: 'dir2025!', nome: 'Joao Fernandes', alcada: 'diretor', centros_custo: ['*'] },
    'dir.tecnico':   { senha: 'dir2025!', nome: 'Ricardo Lima', alcada: 'diretor', centros_custo: ['*'] },
    'dir.financeiro':{ senha: 'dir2025!', nome: 'Maria Santos', alcada: 'diretor', centros_custo: ['*'] },
};

function getUsuarios() {
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
    } catch { return null; }
}

/**
 * POST /api/auth — Login
 * Body: { usuario: string, senha: string }
 * Retorna: { token, usuario, nome, alcada, centros_custo }
 */
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          const { usuario, senha } = body || {};

      if (!usuario || !senha) {
              return res.status(400).json({ error: 'Usuario e senha sao obrigatorios.' });
      }

      const usuarios = getUsuarios();
          const user = usuarios[usuario.toLowerCase()];

      if (!user || user.senha !== senha) {
              console.log('[auth] Login failed for:', usuario);
              return res.status(401).json({ error: 'Usuario ou senha incorretos.' });
      }

      const token = criarToken(usuario.toLowerCase(), user.nome, user.alcada, user.centros_custo || ['*']);
          console.log('[auth] Login OK:', usuario, '| alcada:', user.alcada);

      return res.status(200).json({
              token,
              usuario: usuario.toLowerCase(),
              nome: user.nome,
              alcada: user.alcada,
              centros_custo: user.centros_custo || ['*'],
      });
    } catch (e) {
          console.error('[auth] Error:', e.message);
          return res.status(500).json({ error: 'Erro interno na autenticacao.' });
    }
};

// Exports para uso em outros endpoints (senha.js, dados.js)
module.exports.validarToken = validarToken;
module.exports.getUsuarios = getUsuarios;
module.exports.criarToken = criarToken;
module.exports.USUARIOS_DEFAULT = USUARIOS_DEFAULT;
