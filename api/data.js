const https = require('https');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache header — data can be cached for 2 minutes by CDN
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';

  if (!ghToken) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    // Step 1: Get file SHA from contents endpoint
    const metaData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/contents/dados/plataforma.json',
      ghToken
    );

    if (!metaData || !metaData.sha) {
      throw new Error('Could not find plataforma.json in repository');
    }

    // Step 2: Get raw blob content (supports files > 1MB)
    const rawData = await makeRequest(
      'api.github.com',
      '/repos/' + repo + '/git/blobs/' + metaData.sha,
      ghToken,
      'application/vnd.github.raw+json'
    );

    return res.status(200).json(rawData);
  } catch (e) {
    console.error('[data] Error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to fetch data' });
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
        try {
          if (response.statusCode >= 400) {
            reject(new Error('GitHub API error: ' + response.statusCode + ' - ' + data.substring(0, 200)));
          } else {
            resolve(JSON.parse(data));
          }
        } catch (e) {
          reject(new Error('Failed to parse GitHub response: ' + data.substring(0, 100)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('GitHub API timeout'));
    });
    req.end();
  });
}
