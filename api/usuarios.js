const { validarToken, getUsuariosAsync, lerJSON, salvarJSON } = require('./auth');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Token ausente' });
    const token = auth.replace('Bearer ', '');
    const usuario = validarToken(token);
    if (!usuario) return res.status(401).json({ error: 'Token invalido' });

    try {
          if (req.method === 'GET') {
                  const users = await getUsuariosAsync();
                  const lista = Object.entries(users).map(([login, u]) => ({
                            login,
                            nome: u.nome || login,
                            email: u.email || '',
                            perfil: u.perfil || 'leitor',
                            ativo: u.ativo !== false
                  }));
                  return res.status(200).json(lista);
          }

      if (req.method === 'POST') {
              const { login, nome, email, senha, perfil } = req.body || {};
              if (!login || !senha) return res.status(400).json({ error: 'Login e senha obrigatorios' });
              const { data, sha } = await lerJSON();
              if (!data.usuarios) data.usuarios = {};
              if (data.usuarios[login]) return res.status(409).json({ error: 'Usuario ja existe' });
              data.usuarios[login] = { nome: nome || login, email: email || '', senha, perfil: perfil || 'leitor', ativo: true };
              await salvarJSON(data, sha, 'add usuario ' + login);
              return res.status(201).json({ ok: true });
      }

      if (req.method === 'PUT') {
              const { login, nome, email, senha, perfil, ativo } = req.body || {};
              if (!login) return res.status(400).json({ error: 'Login obrigatorio' });
              const { data, sha } = await lerJSON();
              if (!data.usuarios) data.usuarios = {};
              const u = data.usuarios[login];
              if (!u) return res.status(404).json({ error: 'Usuario nao encontrado' });
              if (nome !== undefined) u.nome = nome;
              if (email !== undefined) u.email = email;
              if (senha !== undefined) u.senha = senha;
              if (perfil !== undefined) u.perfil = perfil;
              if (ativo !== undefined) u.ativo = ativo;
              data.usuarios[login] = u;
              await salvarJSON(data, sha, 'update usuario ' + login);
              return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
              const { login } = req.body || {};
              if (!login) return res.status(400).json({ error: 'Login obrigatorio' });
              const { data, sha } = await lerJSON();
              if (!data.usuarios || !data.usuarios[login]) return res.status(404).json({ error: 'Usuario nao encontrado' });
              delete data.usuarios[login];
              await salvarJSON(data, sha, 'delete usuario ' + login);
              return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Metodo nao permitido' });
    } catch (e) {
          console.error('usuarios error:', e);
          return res.status(500).json({ error: 'Erro interno', details: e.message });
    }
};
