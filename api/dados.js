const https = require('https');
const crypto = require('crypto');

/**
 * GET /api/dados
 * Authenticated data endpoint — requires Authorization: Bearer <token>.
 * Returns the same platform data as /api/data but with token validation.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Validate Bearer token
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido. Envie Authorization: Bearer <token>.' });
  }

  const token = authHeader.slice(7);
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  console.log('[dados] Request authenticated:', user.sub, '| perfil:', user.perfil);

  // Cache header
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';

  if (!ghToken) {
    return res.status(500).json({
      error: 'GITHUB_TOKEN não configurado.',
    });
  }

  try {
    const metaData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/contents/dados/plataforma.json',
      ghToken
    );

    if (!metaData || !metaData.sha) {
      return res.status(500).json({
        error: 'Arquivo dados/plataforma.json não encontrado no repositório ' + repo,
      });
    }

    const rawData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/git/blobs/' + metaData.sha,
      ghToken,
      'application/vnd.github.raw+json'
    );

    if (!rawData || typeof rawData !== 'object') {
      return res.status(500).json({ error: 'Dados inválidos recebidos do GitHub' });
    }

    const pfoCount = Array.isArray(rawData.pfos) ? rawData.pfos.length : 0;
    const ccCount = rawData.centros_custo ? Object.keys(rawData.centros_custo).length : 0;
    console.log(`[dados] Success: ${pfoCount} PFOs, ${ccCount} centros de custo`);

    return res.status(200).json(rawData);
  } catch (e) {
    console.error('[dados] Error:', e.message);
    return res.status(500).json({ error: 'Erro ao buscar dados: ' + e.message });
  }
};

/**
 * Verify the signed token and check expiration.
 */
function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [data, sig] = parts;
    const secret = process.env.PFO_SECRET || 'pfo-gse-default-secret';
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');

    if (sig !== expectedSig) return null;

    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());

    if (payload.exp && payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function makeRequest(host, path, token, accept) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host,
      path,
      method: 'GET',
      headers: {
        Authorization: 'token ' + token,
        Accept: accept || 'application/json',
        'User-Agent': 'PFO-Platform/5.0',
      },
    };

    const req = https.request(opts, (response) => {
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          reject(new Error('Token GitHub inválido ou sem permissão.'));
          return;
        }
        if (response.statusCode === 404) {
          reject(new Error('Repositório ou arquivo não encontrado: ' + path));
          return;
        }
        if (response.statusCode >= 400) {
          reject(new Error('GitHub API status ' + response.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Erro ao interpretar resposta do GitHub'));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Erro de conexão: ' + err.message)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout ao acessar GitHub API'));
    });
    req.end();
  });
}
