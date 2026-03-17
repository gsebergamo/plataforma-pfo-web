const https = require('https');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache header
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';

  if (!ghToken) {
    console.error('[data] GITHUB_TOKEN environment variable is not set');
    return res.status(500).json({
      error: 'GITHUB_TOKEN não configurado. Configure a variável de ambiente no Vercel.',
    });
  }

  console.log('[data] Fetching data from repo:', repo);

  try {
    // Step 1: Get file SHA from contents endpoint
    const metaData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/contents/dados/plataforma.json',
      ghToken
    );

    if (!metaData || !metaData.sha) {
      console.error('[data] No SHA found in metadata response:', JSON.stringify(metaData).substring(0, 200));
      return res.status(500).json({
        error: 'Arquivo dados/plataforma.json não encontrado no repositório ' + repo,
      });
    }

    console.log('[data] File SHA:', metaData.sha, '| Size:', metaData.size, 'bytes');

    // Step 2: Get raw blob content (supports files > 1MB)
    const rawData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/git/blobs/' + metaData.sha,
      ghToken,
      'application/vnd.github.raw+json'
    );

    // Validate we got actual data
    if (!rawData || typeof rawData !== 'object') {
      console.error('[data] Invalid data received from blob endpoint');
      return res.status(500).json({ error: 'Dados inválidos recebidos do GitHub' });
    }

    // Log summary of loaded data
    const pfoCount = Array.isArray(rawData.pfos) ? rawData.pfos.length : 0;
    const ccCount = rawData.centros_custo ? Object.keys(rawData.centros_custo).length : 0;
    console.log(`[data] Success: ${pfoCount} PFOs, ${ccCount} centros de custo`);

    return res.status(200).json(rawData);
  } catch (e) {
    console.error('[data] Error:', e.message);
    return res.status(500).json({
      error: 'Erro ao buscar dados: ' + e.message,
    });
  }
};

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
          reject(new Error('Token GitHub inválido ou sem permissão. Verifique GITHUB_TOKEN no Vercel.'));
          return;
        }
        if (response.statusCode === 404) {
          reject(new Error('Repositório ou arquivo não encontrado: ' + path));
          return;
        }
        if (response.statusCode >= 400) {
          reject(new Error('GitHub API retornou status ' + response.statusCode + ': ' + data.substring(0, 200)));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Erro ao interpretar resposta do GitHub: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Erro de conexão com GitHub: ' + err.message)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout ao acessar GitHub API'));
    });
    req.end();
  });
}
