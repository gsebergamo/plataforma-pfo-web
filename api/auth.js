const crypto = require('crypto');

/**
 * POST /api/auth
 * Validates user credentials and returns a JWT-like token.
 *
 * Body: { usuario: string, senha: string }
 * Response: { token: string, usuario: { nome, perfil } }
 *
 * Credentials are checked against PFO_USERS env var (JSON) or a default list.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  try {
    const { usuario, senha } = req.body || {};

    if (!usuario || !senha) {
      return res.status(400).json({ error: 'Campos "usuario" e "senha" são obrigatórios.' });
    }

    const users = getUsers();
    const user = users.find(
      (u) => u.usuario.toLowerCase() === usuario.toLowerCase() && u.senha === senha
    );

    if (!user) {
      console.log('[auth] Login failed for:', usuario);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = generateToken(user);

    console.log('[auth] Login OK:', usuario, '| perfil:', user.perfil);

    return res.status(200).json({
      token,
      usuario: {
        nome: user.nome,
        perfil: user.perfil,
      },
    });
  } catch (e) {
    console.error('[auth] Error:', e.message);
    return res.status(500).json({ error: 'Erro interno na autenticação.' });
  }
};

/**
 * Load users from PFO_USERS env var or use defaults.
 */
function getUsers() {
  if (process.env.PFO_USERS) {
    try {
      return JSON.parse(process.env.PFO_USERS);
    } catch (e) {
      console.error('[auth] PFO_USERS env var is not valid JSON, using defaults');
    }
  }

  return [
    { usuario: 'admin', senha: 'gse2025', nome: 'Administrador', perfil: 'admin' },
    { usuario: 'paulo.bergamo', senha: 'gse2025', nome: 'Paulo Bergamo', perfil: 'diretor' },
    { usuario: 'diretor', senha: 'gse2025', nome: 'Diretor GSE', perfil: 'diretor' },
    { usuario: 'backoffice', senha: 'gse2025', nome: 'Backoffice GSE', perfil: 'backoffice' },
  ];
}

/**
 * Generate a simple signed token.
 */
function generateToken(user) {
  const payload = {
    sub: user.usuario,
    nome: user.nome,
    perfil: user.perfil,
    iat: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24h
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = process.env.PFO_SECRET || 'pfo-gse-default-secret';
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return data + '.' + sig;
}
