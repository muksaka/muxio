// api/proxy/[...path].js
export default async function handler(req, res) {
  try {
    const { path } = req.query; // array of path segments
    const targetPath = '/' + (path || []).join('/');
    const targetUrl = `https://vidcore.net${targetPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

    const response = await fetch(targetUrl, {
      headers: {
        'Accept-Encoding': 'identity', // avoid gzip for rewriting
        ...req.headers, // forward some headers if needed (optional)
      },
      redirect: 'manual',
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html') || contentType.includes('javascript')) {
      let body = await response.text();

      const blockerScript = `
        <script>
          (function() {
            const orig = window.open;
            window.open = function(url) {
              console.log('Blocked popup:', url);
              return { closed: true, close(){} };
            };
            window.open.toString = () => 'function open() { [native code] }';
            document.addEventListener('click', function(e) {
              let el = e.target;
              while (el && el.tagName !== 'A' && el.tagName !== 'FORM') el = el.parentElement;
              if (el && el.target === '_blank') {
                e.preventDefault();
                if (el.href) window.location.href = el.href;
              }
            }, true);
            document.addEventListener('submit', function(e) {
              if (e.target && e.target.target === '_blank') e.target.target = '_self';
            }, true);
          })();
        </script>`;

      if (contentType.includes('text/html')) {
        // Inject after <head> or at top of body
        body = body.replace(/<head[^>]*>/i, '$&' + blockerScript);
        // Rewrite absolute vidcore URLs to go through proxy
        body = body.replace(/(https:\/\/vidcore\.net)/g, '/api/proxy');
      } else {
        // JavaScript file: prepend the blocker code (without <script> tags)
        body = blockerScript.replace(/<\/?script[^>]*>/g, '') + body;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(response.status).send(body);
      return;
    }

    // Pass through non‑rewritable content (images, fonts, etc.)
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(response.status).send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error');
  }
}
