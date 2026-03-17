const https = require('https');

/**
 * Health Check / Diagnostic Endpoint
 * Visit /api/health in the browser to see exactly what's wrong.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const checks = {
    timestamp: new Date().toISOString(),
    environment: {
      GITHUB_TOKEN: ghToken ? `configurado (${ghToken.substring(0, 4)}...${ghToken.slice(-4)})` : '❌ NÃO CONFIGURADO',
      GITHUB_REPO: repo,
      ANTHROPIC_API_KEY: anthropicKey ? `configurado (${anthropicKey.substring(0, 4)}...${anthropicKey.slice(-4)})` : '❌ NÃO CONFIGURADO',
      NODE_ENV: process.env.NODE_ENV || 'not set',
      VERCEL_ENV: process.env.VERCEL_ENV || 'not set',
    },
    github: { status: 'not tested' },
    data: { status: 'not tested' },
  };

  // Test GitHub token
  if (ghToken) {
    try {
      const repoInfo = await makeRequest('api.github.com', '/repos/' + repo, ghToken);
      checks.github = {
        status: '✅ OK',
        repo_name: repoInfo.full_name,
        private: repoInfo.private,
        permissions: repoInfo.permissions || 'unknown',
      };
    } catch (e) {
      checks.github = {
        status: '❌ FALHOU',
        error: e.message,
        hint: 'Verifique se o GITHUB_TOKEN tem scope "repo" e acesso ao repositório ' + repo,
      };
    }
  } else {
    checks.github = {
      status: '❌ TOKEN AUSENTE',
      hint: 'Configure GITHUB_TOKEN nas Environment Variables do Vercel. Use um Personal Access Token com scope "repo".',
    };
  }

  // Test data file access
  if (ghToken && checks.github.status === '✅ OK') {
    try {
      const fileMeta = await makeRequest(
        'api.github.com',
        '/repos/' + repo + '/contents/dados/plataforma.json',
        ghToken
      );
      checks.data = {
        status: '✅ OK',
        file_sha: fileMeta.sha,
        file_size: fileMeta.size + ' bytes',
        file_path: fileMeta.path,
      };

      // Try to load actual data
      try {
        const rawData = await makeRequest(
          'api.github.com',
          '/repos/' + repo + '/git/blobs/' + fileMeta.sha,
          ghToken,
          'application/vnd.github.raw+json'
        );
        const pfoCount = Array.isArray(rawData.pfos) ? rawData.pfos.length : 0;
        const ccCount = rawData.centros_custo ? Object.keys(rawData.centros_custo).length : 0;
        const keys = Object.keys(rawData);
        checks.data.content = {
          status: '✅ OK',
          total_pfos: pfoCount,
          total_centros_custo: ccCount,
          top_level_keys: keys,
          has_pfos_mensais: Array.isArray(rawData.pfos_mensais),
          has_aprovacoes: !!rawData.aprovacoes,
          has_config: !!rawData.config,
        };
      } catch (e) {
        checks.data.content = {
          status: '❌ FALHOU ao ler conteúdo',
          error: e.message,
        };
      }
    } catch (e) {
      checks.data = {
        status: '❌ ARQUIVO NÃO ENCONTRADO',
        error: e.message,
        hint: 'Verifique se o arquivo dados/plataforma.json existe no repositório ' + repo,
      };
    }
  }

  // Summary
  const allOk = checks.github.status === '✅ OK' && checks.data.status === '✅ OK';
  checks.summary = allOk
    ? '✅ Tudo funcionando! Os dados devem carregar normalmente.'
    : '❌ Há problemas. Veja os detalhes acima.';

  return res.status(200).json(checks);
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
        if (response.statusCode >= 400) {
          reject(new Error(`GitHub API ${response.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Connection: ' + err.message)));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}
