import {
  buildTelegramUrl,
  escapeHtml,
  extractDomain,
  isBotConfigured,
  loadSettings,
} from './helpers.ts';
import type { Env, LinkRow } from './types.ts';

export async function renderPicLinkPage(
  slug: string,
  request: Request,
  env: Env
): Promise<Response> {
  const cleanSlug = (slug || '').trim();
  const settings = await loadSettings(env.DB);
  const url = new URL(request.url);
  const origin = env.APP_URL ? env.APP_URL.replace(/\/+$/, '') : url.origin;

  const link = await env.DB.prepare(
    'SELECT * FROM links WHERE slug = ? LIMIT 1'
  )
    .bind(cleanSlug)
    .first<LinkRow>();

  const isExpired = Boolean(link?.expires_at && Date.now() > link.expires_at);

  if (!link || link.is_disabled === 1 || isExpired) {
    const title = escapeHtml(`${settings.site_name} — Link Unavailable`);
    const reason = isExpired
      ? 'This shared link has expired.'
      : 'This link is unavailable or has been disabled.';
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <meta name="robots" content="noindex" />
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08080A;color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;}
    .card{max-width:420px;width:100%;background:#111115;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:28px;text-align:center;}
    h1{font-size:18px;margin:0 0 8px;font-weight:600;}
    p{font-size:14px;color:#A1A1AA;margin:0 0 20px;line-height:1.5;}
    a{display:inline-block;padding:12px 20px;border-radius:12px;background:#10B981;color:#04120C;text-decoration:none;font-weight:600;font-size:14px;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Link Unavailable</h1>
    <p>${escapeHtml(reason)}</p>
    <a href="${escapeHtml(origin)}">Open ${escapeHtml(settings.site_name)}</a>
  </div>
</body>
</html>`;
    return new Response(html, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const pageTitle = link.title.trim() || `Unlock ${extractDomain(link.destination_url)}`;
  const pageDescription =
    link.description.trim() ||
    `Open in ${settings.site_name} on Telegram to watch a short sponsored ad and unlock this destination.`;
  const telegramDeepLink = buildTelegramUrl(link.slug, settings);
  const webPreviewUnlockUrl = `${origin}/?startapp=r_${encodeURIComponent(link.slug)}`;
  const canonicalUrl = `${origin}/r/${encodeURIComponent(link.slug)}`;

  let ogImageUrl = '';
  if (link.image_url) {
    if (link.image_url.startsWith('/')) {
      ogImageUrl = `${origin}${link.image_url}`;
    } else {
      ogImageUrl = link.image_url;
    }
  }

  const domain = extractDomain(link.destination_url);
  const autoRedirect = url.searchParams.get('auto') === '1';

  const botReady = isBotConfigured(settings);
  const primaryHref = botReady ? telegramDeepLink : webPreviewUnlockUrl;
  const primaryLabel = botReady ? 'Open in Telegram to Unlock' : 'Unlock Destination Link';

  const brandLogoUrl = settings.site_logo_url
    ? settings.site_logo_url.startsWith('/')
      ? `${origin}${settings.site_logo_url}`
      : settings.site_logo_url
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(pageTitle)} — ${escapeHtml(settings.site_name)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${escapeHtml(settings.site_name)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:title" content="${escapeHtml(pageTitle)}" />
  <meta property="og:description" content="${escapeHtml(pageDescription)}" />
  ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />` : ''}
  ${ogImageUrl ? `<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />` : ''}
  <meta name="twitter:card" content="${ogImageUrl ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(pageDescription)}" />
  ${ogImageUrl ? `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />` : ''}
  <meta name="theme-color" content="#08080A" />
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08080A;color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;}
    .wrap{width:100%;max-width:440px;}
    .brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;font-size:13px;color:#A1A1AA;}
    .brand-left{display:flex;align-items:center;gap:10px;}
    .brand-logo{width:28px;height:28px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);}
    .brand strong{color:#F4F4F6;font-size:15px;letter-spacing:-0.01em;}
    .card{background:#111115;border:1px solid rgba(255,255,255,0.1);border-radius:20px;overflow:hidden;}
    .thumb{width:100%;aspect-ratio:16/9;background:#18181F;display:block;object-fit:cover;}
    .body{padding:22px;}
    .meta{font-size:12px;color:#10B981;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-bottom:8px;}
    h1{margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.015em;}
    p{margin:0 0 20px;font-size:14px;line-height:1.55;color:#A1A1AA;}
    .cta{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:12px 18px;border-radius:12px;background:#10B981;color:#04120C;font-weight:600;font-size:15px;text-decoration:none;transition:opacity .15s;}
    .cta:hover{opacity:.92}
    .secondary{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:10px;padding:10px 16px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);color:#E4E4E7;font-weight:500;font-size:13px;text-decoration:none;}
    .secondary:hover{background:rgba(255,255,255,0.04)}
    .foot{margin-top:14px;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#71717A;}
    label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="brand">
      <div class="brand-left">
        ${brandLogoUrl ? `<img class="brand-logo" src="${escapeHtml(brandLogoUrl)}" alt="${escapeHtml(settings.site_name)}" referrerpolicy="no-referrer" />` : ''}
        <strong>${escapeHtml(settings.site_name)}</strong>
      </div>
      <span>Verified Preview</span>
    </div>
    <article class="card">
      ${ogImageUrl ? `<img class="thumb" src="${escapeHtml(ogImageUrl)}" alt="${escapeHtml(pageTitle)}" referrerpolicy="no-referrer" />` : ''}
      <div class="body">
        <div class="meta">Destination · ${escapeHtml(domain)}</div>
        <h1>${escapeHtml(pageTitle)}</h1>
        <p>${escapeHtml(pageDescription)}</p>
        <a class="cta" id="tgBtn" href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>
        ${botReady ? `<a class="secondary" href="${escapeHtml(webPreviewUnlockUrl)}">Open Web Unlock Preview</a>` : ''}
        <div class="foot">
          <span>Watch a short sponsored ad to unlock</span>
          ${botReady ? `<label><input type="checkbox" id="autoToggle" ${autoRedirect ? 'checked' : ''} /> Auto-open mobile</label>` : ''}
        </div>
      </div>
    </article>
  </main>
  <script>
    (function(){
      var botReady = ${botReady ? 'true' : 'false'};
      if (!botReady) return;
      var tgUrl = ${JSON.stringify(telegramDeepLink).replace(/</g, '\\u003c')};
      var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      var toggle = document.getElementById('autoToggle');
      var saved = localStorage.getItem('lv_auto_redirect') === '1';
      if (saved && toggle) toggle.checked = true;
      if (toggle) {
        toggle.addEventListener('change', function(){
          localStorage.setItem('lv_auto_redirect', toggle.checked ? '1' : '0');
        });
      }
      if (isMobile && (${autoRedirect ? 'true' : 'false'} || saved)) {
        setTimeout(function(){ window.location.href = tgUrl; }, 900);
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
