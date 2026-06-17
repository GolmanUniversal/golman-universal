// Golman Universal — same-origin chat proxy (Vercel serverless, zero dependencies).
//
// The browser chat widget POSTs here (same origin, so no secret ever ships to the
// client). This function holds CHAT_WEBHOOK_SECRET server-side and forwards to the
// golman AI agent, mirroring the secret never leaving the server. Degrades
// gracefully: if CHAT_WEBHOOK_SECRET is unset, it returns a friendly fallback
// pointing at the contact form instead of erroring — so shipping this file to
// production is safe even before the secret is configured.
//
//   Optional env:  CHAT_WEBHOOK_SECRET  (must match the agent's; the gate)
//                  AGENT_CHAT_URL       (default https://agent.golmanuniversal.com/api/chat)

const FALLBACK = "Chat isn't available right now — please use the contact form at /contact and Alex will follow up personally.";

function parseBody(req) {
  let b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch { return {}; } }
  return b;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = process.env.CHAT_WEBHOOK_SECRET;
  if (!secret) {
    // Not configured yet — degrade gracefully rather than show a broken widget.
    return res.status(200).json({ reply: FALLBACK });
  }
  const url = process.env.AGENT_CHAT_URL || 'https://agent.golmanuniversal.com/api/chat';

  const b = parseBody(req);
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId : '';
  const message = typeof b.message === 'string' ? b.message : '';
  const lane = typeof b.lane === 'string' ? b.lane : undefined;
  if (!sessionId || !message) return res.status(400).json({ error: 'bad_request' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
      body: JSON.stringify({ sessionId, message, lane }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('chat-proxy: agent non-ok', r.status);
      return res.status(200).json({ reply: FALLBACK });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('chat-proxy: error', err.name === 'AbortError' ? 'timeout' : err.message);
    return res.status(200).json({ reply: FALLBACK });
  } finally {
    clearTimeout(timer);
  }
};
