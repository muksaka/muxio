// api/proxy/[...path].js
export default async function handler(req, res) {
  try {
    const { path } = req.query;
    const targetPath = '/' + (path || []).join('/');
    const targetUrl = `https://vidcore.net${targetPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

    const response = await fetch(targetUrl, {
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Referer': 'https://vidcore.net/',
      },
    });

    const contentType = response.headers.get('content-type') || '';

    const isText = contentType.includes('text/html') ||
                   contentType.includes('javascript') ||
                   contentType.includes('text/css') ||
                   contentType.includes('application/json');

    if (isText) {
      let body = await response.text();

      // Rewrite all absolute vidcore.net URLs
      body = body.replace(/https?:\/\/vidcore\.net/g, '/api/proxy');

      // Inject popup blocker AND referrer spoofing into HTML
      if (contentType.includes('text/html')) {
        const injectedScript = `
          <script>
            (function() {
              // 1. Spoof document.referrer so VidCore thinks it's on its own site
              try {
                Object.defineProperty(document, 'referrer', {
                  get: function() { return 'https://vidcore.net/'; },
                  configurable: true
                });
              } catch(e) {}

              // 2. Block popups
              var origOpen = window.open;
              window.open = function(url) {
                console.log('Blocked popup:', url);
                return {
                  closed: true,
                  close: function(){},
                  focus: function(){},
                  blur: function(){},
                  location: { href: 'about:blank' },
                  document: { write: function(){} }
                };
              };
              window.open.toString = function() { return 'function open() { [native code] }'; };

              // 3. Prevent top navigation
              if (window.top !== window) {
                try {
                  Object.defineProperty(window, 'top', { get: function(){ return window; } });
                } catch(e) {}
              }
            })();
          </script>`;
        body = body.replace(/<head[^>]*>/i, '$&' + injectedScript);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.status(response.status).send(body);
      return;
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(response.status).send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error');
  }
}
