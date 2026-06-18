// api/proxy/[...path].js
export default async function handler(req, res) {
  try {
    const { path } = req.query;
    const targetPath = '/' + (path || []).join('/');
    const targetUrl = `https://vidcore.net${targetPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

    // Fetch the real page from VidCore, following redirects
    const response = await fetch(targetUrl, {
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Referer': 'https://vidcore.net/',          // make VidCore think it's a normal request
      },
      // Remove 'redirect: manual' – let it follow automatically
    });

    const contentType = response.headers.get('content-type') || '';

    // Rewrite any text-based content (HTML, JS, CSS, JSON)
    const isText = contentType.includes('text/html') ||
                   contentType.includes('javascript') ||
                   contentType.includes('text/css') ||
                   contentType.includes('application/json');

    if (isText) {
      let body = await response.text();

      // Rewrite all absolute vidcore.net URLs to go through our proxy
      body = body.replace(/https?:\/\/vidcore\.net/g, '/api/proxy');

      // Only inject popup blocker into HTML
      if (contentType.includes('text/html')) {
        const blockerScript = `
          <script>
            (function() {
              // Block popups
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

              // Block top navigation (optional safety)
              if (window.top !== window) {
                var _top = window.top;
                Object.defineProperty(window, 'top', { get: function(){ return window; } });
              }
            })();
          </script>`;
        body = body.replace(/<head[^>]*>/i, '$&' + blockerScript);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.status(response.status).send(body);
      return;
    }

    // Binary content – just pass through
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(response.status).send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error');
  }
}
