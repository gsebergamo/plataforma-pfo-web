/**
 * /api/usuarios — CRUD de usuarios (admin only)
 * GET    → lista todos os usuarios (sem senhas)
 * POST   → cria novo usuario
 * PUT    → edita usuario existente
 * DELETE → remove usuario
 *
 * Requer Authorization: Bearer <token> com alcada === 'admin'
 * Persiste via env var PFO_USERS (JSON) — para persistencia real,
 * integrar com GitHub JSON como no repo principal.
 */
const { validarToken, getUsuarios, USUARIOS_DEFAULT } = require('./auth');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function autenticarAdmin(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token nao fornecido.' });
    return null;
  }
  const user = validarToken(authHeader.slice(7));
  if (!user) {
    res.status(401).json({ error: 'Token invalido ou expirado.' });
    return null;
  }
  if (user.alcada !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores.' });
    return null;
  }
  return user;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET nao requer admin para listar (mas requer auth)
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token nao fornecido.' });
    }
    const user = validarToken(authHeader.slice(7));
    if (!user) return res.status(401).json({ error: 'Token invalido.' });

    // Apenas admin ve a lista completa
    if (user.alcada !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores.' });
    }

    const usuarios = getUsuarios();
    // Retorna sem senhas
    const lista = Object.entries(usuarios).map(([login, info]) => ({
      login,
      nome: info.nome,
      email: info.email || '',
      alcada: info.alcada,
      centros_custo: info.centros_custo || ['*'],
      ativo: info.ativo !== false,
    }));
    return res.status(200).json({ usuarios: lista });
  }

  // POST, PUT, DELETE requerem admin
  const admin = autenticarAdmin(req, res);
  if (!admin) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  if (req.method === 'POST') {
    // Criar usuario
    const { login, nome, email, senha, alcada, centros_custo } = body || {};
    if (!login || !nome || !senha || !alcada) {
      return res.status(400).json({ error: 'login, nome, senha e alcada sao obrigatorios.' });
    }
    const usuarios = getUsuarios();
    if (usuarios[login.toLowerCase()]) {
      return res.status(409).json({ error: 'Usuario ja existe: ' + login });
    }
    // Nota: para persistencia real, salvar no GitHub JSON ou atualizar PFO_USERS
    console.log('[usuarios] Criado:', login, '| alcada:', alcada, '| por:', admin.usuario);
    return res.status(201).json({
      success: true,
      message: 'Usuario criado. Adicione ao PFO_USERS env var para persistir.',
      usuario: { login: login.toLowerCase(), nome, email: email || '', alcada, centros_custo: centros_custo || ['*'] },
    });
  }

  if (req.method === 'PUT') {
    // Editar usuario
    const { login, nome, email, senha, alcada, centros_custo, ativo } = body || {};
    if (!login) {
      return res.status(400).json({ error: 'login e obrigatorio.' });
    }
    const usuarios = getUsuarios();
    if (!usuarios[login.toLowerCase()]) {
      return res.status(404).json({ error: 'Usuario nao encontrado: ' + login });
    }
    console.log('[usuarios] Editado:', login, '| por:', admin.usuario);
    return res.status(200).json({
      success: true,
      message: 'Usuario atualizado. Atualize PFO_USERS env var para persistir.',
      usuario: { login: login.toLowerCase(), nome, email: email || '', alcada, centros_custo: centros_custo || ['*'], ativo },
    });
  }

  if (req.method === 'DELETE') {
    const { login } = body || {};
    if (!login) {
      return res.status(400).json({ error: 'login e obrigatorio.' });
    }
    if (USUARIOS_DEFAULT[login.toLowerCase()]) {
      return res.status(400).json({ error: 'Nao e possivel remover usuarios padrao do sistema.' });
    }
    console.log('[usuarios] Removido:', login, '| por:', admin.usuario);
    return res.status(200).json({
      success: true,
      message: 'Usuario removido.',
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
