const crypto = require('crypto');
const https = require('https');
const { getUsuariosAsync, lerJSON, salvarJSON } = require('./auth');

function enviarEmail(to, subject, html) {
    const apikey = process.env.RESEND_API_KEY;
    if (!apikey) {
          console.error('[recuperar] RESEND_API_KEY nao configurada');
          return Promise.reject(new Error('Servico de email nao configurado.'));
    }
    const from = process.env.EMAIL_FROM || 'Plataforma PFO <noreply@plataforma-pfo-web.vercel.app>';
    const payload = JSON.stringify({ from, to, subject, html });
    return new Promise((resolve, reject) => {
          const req = https.request({
                  hostname: 'api.resend.com',
                  path: '/emails',
                  method: 'POST',
                  headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + apikey,
                            'Content-Length': Buffer.byteLength(payload),
                  },
          }, (res) => {
                  let data = '';
                  res.on('data', c => data += c);
                  res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                        resolve(JSON.parse(data));
                            } else {
                                        reject(new Error('Email API error: ' + res.statusCode + ' ' + data));
                            }
                  });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          const { usuario } = body || {};

      if (!usuario) {
              return res.status(400).json({ error: 'Informe o usuario.' });
      }

      const { data, sha } = await lerJSON();
          if (!data.usuarios) data.usuarios = {};
          const user = data.usuarios[usuario.toLowerCase()];

      if (!user) {
              return res.status(200).json({
                        success: true,
                        message: 'Se o usuario existir e tiver email cadastrado, uma nova senha sera enviada.',
              });
      }

      if (!user.email) {
              return res.status(200).json({
                        success: true,
                        message: 'Se o usuario existir e tiver email cadastrado, uma nova senha sera enviada.',
              });
      }

      const novaSenha = 'pfo' + crypto.randomBytes(3).toString('hex') + '!';

      const htmlEmail = `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
                    <h2 style="color:#4f8ef7">Plataforma PFO - GSE</h2>
                            <p>Ola <strong>${user.nome}</strong>,</p>
                                    <p>Recebemos uma solicitacao de recuperacao de senha para sua conta.</p>
                                            <p>Sua nova senha temporaria e:</p>
                                                    <div style="background:#f0f0f0;padding:15px;border-radius:8px;text-align:center;font-size:20px;font-weight:bold;letter-spacing:2px;margin:16px 0">
                                                              ${novaSenha}
                                                                      </div>
                                                                              <p>Acesse a plataforma e altere sua senha assim que possivel.</p>
                                                                                      <p style="color:#888;font-size:12px;margin-top:20px">
                                                                                                Se voce nao solicitou esta alteracao, ignore este email.<br>
                                                                                                          Global Service Engenharia - Plataforma PFO
                                                                                                                  </p>
                                                                                                                        </div>
                                                                                                                            `;

      user.senha = novaSenha;
          data.usuarios[usuario.toLowerCase()] = user;
          await salvarJSON(data, sha, 'recuperar senha ' + usuario);

      try {
              await enviarEmail(user.email, 'Plataforma PFO - Recuperacao de Senha', htmlEmail);
              console.log('[recuperar] Email enviado para:', user.email, '| usuario:', usuario);
      } catch (emailErr) {
              console.error('[recuperar] Erro ao enviar email:', emailErr.message);
              return res.status(500).json({
                        error: 'Erro ao enviar email. Contacte o administrador.',
              });
      }

      return res.status(200).json({
              success: true,
              message: 'Se o usuario existir e tiver email cadastrado, uma nova senha sera enviada.',
      });
    } catch (e) {
          console.error('[recuperar] Error:', e.message);
          return res.status(500).json({ error: 'Erro interno: ' + e.message });
    }
};
