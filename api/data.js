const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const ghToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'gsebergamo/plataforma-pfo';
  
  try {
    // Step 1: get file SHA
    const metaData = await makeRequest('api.github.com', 
      '/repos/' + repo + '/contents/dados/plataforma.json',
      ghToken);
    
    // Step 2: get raw blob
    const rawData = await makeRequest('api.github.com',
      '/repos/' + repo + '/git/blobs/' + metaData.sha,
      ghToken, 'application/vnd.github.raw+json');
    
    return res.status(200).json(rawData);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

function makeRequest(host, path, token, accept) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host, path, method: 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': accept || 'application/json',
        'User-Agent': 'PFO-Platform'
      }
    };
    const req = require('https').request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          if (accept && accept.includes('raw')) resolve(JSON.parse(data));
          else resolve(JSON.parse(data));
        } catch(e) { reject(new Error('Parse: ' + data.substring(0,100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}