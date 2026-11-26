import { Check, Copy, Eye, EyeOff, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { copyToClipboard, triggerHaptic } from '../lib/telegram.ts';

interface ApiTabProps {
  apiKey: string;
  origin: string;
  adminToken: string;
  onApiKeyUpdated: (newKey: string) => void;
  onLinkCreatedViaApi?: () => void;
}

export function ApiTab({
  apiKey,
  origin,
  adminToken,
  onApiKeyUpdated,
  onLinkCreatedViaApi,
}: ApiTabProps) {
  const [revealKey, setRevealKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [snippetLang, setSnippetLang] = useState<'curl' | 'js' | 'python'>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Live API Tester state
  const [testMethod, setTestMethod] = useState<'GET' | 'POST'>('POST');
  const [testUrl, setTestUrl] = useState('https://core.telegram.org/bots/webapps');
  const [testSlug, setTestSlug] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    ms: number;
    body: string;
  } | null>(null);

  // Rewarded Ad Gate API Tester state
  const [gateTitle, setGateTitle] = useState('Unlock Next Reels');
  const [gateExtUser, setGateExtUser] = useState('123456789');
  const [gateTesting, setGateTesting] = useState(false);
  const [copiedGateSnippet, setCopiedGateSnippet] = useState(false);
  const [gateResult, setGateResult] = useState<{
    status: number;
    ms: number;
    body: string;
    sessionId?: string;
    webUrl?: string;
  } | null>(null);

  const baseOrigin = origin || window.location.origin;
  const maskedKey = apiKey ? `${apiKey.slice(0, 7)}${'•'.repeat(18)}${apiKey.slice(-4)}` : '';
  const displayKey = revealKey ? apiKey : maskedKey;

  const snippets: Record<'curl' | 'js' | 'python', string> = {
    curl: `# GET quick shorten
curl "${baseOrigin}/api/v1/shorten?api=${apiKey}&url=https://example.com"

# POST with PicLink card metadata
curl -X POST "${baseOrigin}/api/v1/shorten" \\
  -H "Content-Type: application/json" \\
  -d '{
    "api_key": "${apiKey}",
    "url": "https://example.com",
    "title": "Exclusive Creator Pack"
  }'`,
    js: `const res = await fetch("${baseOrigin}/api/v1/shorten", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "${apiKey}"
  },
  body: JSON.stringify({
    url: "https://example.com",
    title: "Exclusive Creator Pack"
  })
});
const data = await res.json();
console.log(data.telegram_url, data.piclink_url);`,
    python: `import requests

resp = requests.post(
    "${baseOrigin}/api/v1/shorten",
    headers={"X-API-Key": "${apiKey}"},
    json={
        "url": "https://example.com",
        "title": "Exclusive Creator Pack",
    },
    timeout=10,
)
data = resp.json()
print(data["telegram_url"], data["piclink_url"])`,
  };

  const handleCopyKey = async () => {
    const ok = await copyToClipboard(apiKey);
    if (ok) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1600);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiFetch<{ api_key: string }>('/api/admin/api-key/regenerate', {
        method: 'POST',
        adminToken,
      });
      onApiKeyUpdated(res.api_key);
      setConfirmRegen(false);
      triggerHaptic('success');
    } catch {
      triggerHaptic('error');
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopySnippet = async () => {
    const ok = await copyToClipboard(snippets[snippetLang]);
    if (ok) {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1600);
    }
  };

  const handleRunTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    const start = performance.now();
    try {
      let res: Response;
      if (testMethod === 'GET') {
        const params = new URLSearchParams({
          api: apiKey,
          url: testUrl.trim(),
        });
        if (testSlug.trim()) params.set('slug', testSlug.trim());
        if (testTitle.trim()) params.set('title', testTitle.trim());
        res = await fetch(`/api/v1/shorten?${params.toString()}`);
      } else {
        res = await fetch('/api/v1/shorten', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({
            url: testUrl.trim(),
            slug: testSlug.trim() || undefined,
            title: testTitle.trim() || undefined,
          }),
        });
      }
      const json = await res.json();
      const elapsed = Math.round(performance.now() - start);
      setTestResult({
        status: res.status,
        ms: elapsed,
        body: JSON.stringify(json, null, 2),
      });
      if (res.ok) {
        triggerHaptic('success');
        onLinkCreatedViaApi?.();
      }
    } catch (err) {
      setTestResult({
        status: 0,
        ms: Math.round(performance.now() - start),
        body: JSON.stringify({ error: err instanceof Error ? err.message : 'Network error' }, null, 2),
      });
    } finally {
      setTesting(false);
    }
  };

  const gateSnippet = `# 1. Create a 30-min Rewarded Ad Gate session
curl -X POST "${baseOrigin}/api/v1/gate/create" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"title": "Unlock Next Reels", "external_user_id": "123456789"}'

# 2. Verify & consume once user returns from Telegram.WebApp.close()
curl "${baseOrigin}/api/v1/gate/status/gate_SESSION_ID?consume=1" \\
  -H "X-API-Key: ${apiKey}"`;

  const handleCopyGateSnippet = async () => {
    const ok = await copyToClipboard(gateSnippet);
    if (ok) {
      setCopiedGateSnippet(true);
      setTimeout(() => setCopiedGateSnippet(false), 1600);
    }
  };

  const handleCreateGateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateTesting(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/v1/gate/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          title: gateTitle.trim() || undefined,
          external_user_id: gateExtUser.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { session_id?: string; web_url?: string };
      setGateResult({
        status: res.status,
        ms: Math.round(performance.now() - start),
        body: JSON.stringify(json, null, 2),
        sessionId: json.session_id,
        webUrl: json.web_url,
      });
      if (res.ok) triggerHaptic('success');
    } catch (err) {
      setGateResult({
        status: 0,
        ms: Math.round(performance.now() - start),
        body: JSON.stringify({ error: err instanceof Error ? err.message : 'Network error' }, null, 2),
      });
    } finally {
      setGateTesting(false);
    }
  };

  const handleCheckGateStatus = async (sessionId: string, consume: boolean) => {
    setGateTesting(true);
    const start = performance.now();
    try {
      const res = await fetch(
        `/api/v1/gate/status/${encodeURIComponent(sessionId)}${consume ? '?consume=1' : ''}`,
        { headers: { 'X-API-Key': apiKey } }
      );
      const json = await res.json();
      setGateResult((prev) => ({
        status: res.status,
        ms: Math.round(performance.now() - start),
        body: JSON.stringify(json, null, 2),
        sessionId: prev?.sessionId,
        webUrl: prev?.webUrl,
      }));
    } finally {
      setGateTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Personal API Key */}
      <section className="bg-[#111115] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">Admin Developer API Key</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Private admin-only REST API key for automating link creation from bots or scripts. Not exposed to public users.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400">Admin Only · REST v1</span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl bg-[#08080A] border border-white/10 px-3.5 min-h-[46px]">
            <code className="font-mono text-xs sm:text-sm text-emerald-300 truncate">
              {displayKey}
            </code>
            <button
              type="button"
              onClick={() => setRevealKey((v) => !v)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-white shrink-0"
              aria-label={revealKey ? 'Hide API key' : 'Reveal API key'}
            >
              {revealKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyKey}
              className="flex-1 sm:flex-initial min-h-[46px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
            </button>

            {confirmRegen ? (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={handleRegenerate}
                  className="min-h-[46px] px-3.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-semibold whitespace-nowrap"
                >
                  {regenerating ? 'Rotating...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRegen(false)}
                  className="min-h-[46px] px-3 rounded-xl border border-white/10 text-zinc-400 text-xs whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRegen(true)}
                className="min-h-[46px] px-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-300 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Code Snippets */}
        <section className="lg:col-span-7 bg-[#111115] border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#08080A] border border-white/10 rounded-xl">
              {(
                [
                  ['curl', 'cURL'],
                  ['js', 'JavaScript'],
                  ['python', 'Python'],
                ] as const
              ).map(([lang, label]) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setSnippetLang(lang)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    snippetLang === lang
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopySnippet}
              className="min-h-[36px] px-3 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedSnippet ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedSnippet ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <pre className="p-5 overflow-x-auto font-mono text-xs leading-relaxed text-zinc-300 bg-[#08080A]/60">
            <code>{snippets[snippetLang]}</code>
          </pre>

          <div className="px-5 py-4 border-t border-white/10 space-y-2 text-xs text-zinc-400">
            <div className="flex items-center justify-between gap-3 font-mono">
              <span className="text-emerald-400">GET</span>
              <span className="truncate text-zinc-300">/api/v1/shorten?api=KEY&amp;url=DEST</span>
            </div>
            <div className="flex items-center justify-between gap-3 font-mono">
              <span className="text-emerald-400">POST</span>
              <span className="truncate text-zinc-300">/api/v1/shorten (JSON + X-API-Key)</span>
            </div>
          </div>
        </section>

        {/* Live Test API Runner */}
        <section className="lg:col-span-5 bg-[#111115] border border-white/10 rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Live API Runner</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Execute a real request against your account&apos;s endpoint right here.
            </p>
          </div>

          <form onSubmit={handleRunTest} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#08080A] border border-white/10 rounded-xl">
              {(['POST', 'GET'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTestMethod(m)}
                  className={`min-h-[36px] rounded-lg font-mono text-xs font-medium transition-colors ${
                    testMethod === m
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {m} /api/v1/shorten
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs text-zinc-300 mb-1">Destination URL</label>
              <input
                type="url"
                required
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3 text-xs text-white focus:border-emerald-500/60 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Slug (optional)</label>
                <input
                  type="text"
                  value={testSlug}
                  onChange={(e) => setTestSlug(e.target.value)}
                  placeholder="auto"
                  className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Title (optional)</label>
                <input
                  type="text"
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                  placeholder="API Link"
                  className="w-full min-h-[42px] rounded-xl bg-[#08080A] border border-white/10 px-3 text-xs text-white placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={testing}
              className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{testing ? 'Sending Request...' : 'Test API Request'}</span>
            </button>
          </form>

          {testResult && (
            <div className="pt-3 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span
                  className={
                    testResult.status >= 200 && testResult.status < 300
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }
                >
                  HTTP {testResult.status}
                </span>
                <span className="text-zinc-500 tabular-nums">{testResult.ms} ms</span>
              </div>
              <pre className="p-3.5 rounded-xl bg-[#08080A] border border-white/10 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-200 max-h-56">
                <code>{testResult.body}</code>
              </pre>
            </div>
          )}
        </section>
      </div>

      {/* Rewarded Ad Gate (Close & Verify) Partner API */}
      <section className="bg-[#111115] border border-white/10 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-white">
              Rewarded Ad Gate API (Close &amp; Verify)
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              For partner Telegram Mini Apps: send users through your multi-step ad flow, then auto-close back via{' '}
              <code className="font-mono text-zinc-300">Telegram.WebApp.close()</code> and verify completion server-side.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400 shrink-0">30-Min TTL · One-Time Consume</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-7 bg-[#08080A] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-zinc-400">
                POST /api/v1/gate/create · GET /api/v1/gate/status/:id?consume=1
              </span>
              <button
                type="button"
                onClick={handleCopyGateSnippet}
                className="min-h-[32px] px-2.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedGateSnippet ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedGateSnippet ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-4 overflow-x-auto font-mono text-xs leading-relaxed text-zinc-300">
              <code>{gateSnippet}</code>
            </pre>
          </div>

          <div className="lg:col-span-5 space-y-3.5">
            <form onSubmit={handleCreateGateTest} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-300 mb-1">Gate Title</label>
                <input
                  type="text"
                  value={gateTitle}
                  onChange={(e) => setGateTitle(e.target.value)}
                  placeholder="Unlock Next Reels"
                  className="w-full min-h-[40px] rounded-xl bg-[#08080A] border border-white/10 px-3 text-xs text-white focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">
                  External User ID (optional)
                </label>
                <input
                  type="text"
                  value={gateExtUser}
                  onChange={(e) => setGateExtUser(e.target.value)}
                  placeholder="123456789"
                  className="w-full min-h-[40px] rounded-xl bg-[#08080A] border border-white/10 px-3 font-mono text-xs text-white focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={gateTesting}
                className="w-full min-h-[42px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{gateTesting ? 'Running...' : 'Create Test Gate Session'}</span>
              </button>
            </form>

            {gateResult && (
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span
                    className={
                      gateResult.status >= 200 && gateResult.status < 300
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }
                  >
                    HTTP {gateResult.status}
                  </span>
                  <span className="text-zinc-500 tabular-nums">{gateResult.ms} ms</span>
                </div>
                <pre className="p-3 rounded-xl bg-[#08080A] border border-white/10 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-200 max-h-48">
                  <code>{gateResult.body}</code>
                </pre>
                {gateResult.sessionId && (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/?startapp=${encodeURIComponent(gateResult.sessionId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[34px] px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-medium inline-flex items-center"
                    >
                      Open Gate Preview
                    </a>
                    <button
                      type="button"
                      disabled={gateTesting}
                      onClick={() => handleCheckGateStatus(gateResult.sessionId!, false)}
                      className="min-h-[34px] px-3 rounded-lg border border-white/10 hover:bg-white/5 text-zinc-200 text-xs"
                    >
                      Check Status
                    </button>
                    <button
                      type="button"
                      disabled={gateTesting}
                      onClick={() => handleCheckGateStatus(gateResult.sessionId!, true)}
                      className="min-h-[34px] px-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs"
                    >
                      Verify &amp; Consume
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
