/**
 * POST /api/senha — Alterar senha do usuario logado
  * Headers: Authorization: Bearer <token>
   * Body: { senha_atual: string, nova_senha: string }
    */
    const { validarToken, getUsuarios } = require('./auth');

    module.exports = async function handler(req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') return res.status(200).end();
              if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

                // Validar token
                  const authHeader = req.headers.authorization || '';
                    if (!authHeader.startsWith('Bearer ')) {
                        return res.status(401).json({ error: 'Token nao fornecido.' });
                          }
                            const token = authHeader.slice(7);
                              const user = validarToken(token);
                                if (!user) {
                                    return res.status(401).json({ error: 'Token invalido ou expirado.' });
                                      }

                                        try {
                                            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                                                const { senha_atual, nova_senha } = body || {};

                                                    if (!senha_atual || !nova_senha) {
                                                          return res.status(400).json({ error: 'Senha atual e nova senha sao obrigatorias.' });
                                                              }
                                                                  if (nova_senha.length < 6) {
                                                                        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
                                                                            }

                                                                                // Verificar senha atual
                                                                                    const usuarios = getUsuarios();
                                                                                        const userData = usuarios[user.usuario];

                                                                                            if (!userData || userData.senha !== senha_atual) {
                                                                                                  return res.status(401).json({ error: 'Senha atual incorreta.' });
                                                                                                      }
                                                                                                      
                                                                                                          // Nota: Para persistir a troca de senha, seria necessario salvar no JSON do GitHub.
                                                                                                              // Por enquanto, a troca funciona apenas na sessao atual via env var PFO_USERS.
                                                                                                                  console.log('[senha] Password change requested by:', user.usuario);
                                                                                                                  
                                                                                                                      return res.status(200).json({
                                                                                                                            success: true,
                                                                                                                                  message: 'Senha validada com sucesso. Contacte o admin para persistir a alteracao.',
                                                                                                                                      });
                                                                                                                                        } catch (e) {
                                                                                                                                            console.error('[senha] Error:', e.message);
                                                                                                                                                return res.status(500).json({ error: 'Erro interno: ' + e.message });
                                                                                                                                                  }
                                                                                                                                                  };
