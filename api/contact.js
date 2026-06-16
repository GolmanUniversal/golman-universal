// Golman Universal — contact form handler (Vercel serverless, zero dependencies).
// The /contact form POSTs here; we email Alex via the Resend REST API.
//
// Required env:  RESEND_API_KEY
// Optional env:  CONTACT_TO   (default alexander@golmanuniversal.com)
//                CONTACT_FROM (default "Golman Universal <noreply@golmanuniversal.com>")
//
// Resend needs golmanuniversal.com verified before CONTACT_FROM can use that domain.
// Until then, set CONTACT_FROM="Golman Universal <onboarding@resend.dev>" and
// CONTACT_TO to the Resend account owner's address for testing.
//
// AGENT INTAKE (optional, best-effort): after the direct email to Alex (the
// guaranteed record) succeeds, we additionally hand the submission to the golman AI
// agent, which sends the visitor an instant acknowledgment from
// hello@golmanuniversal.com. Gated on AGENT_INTAKE_SECRET — if it's unset, the agent
// call is skipped entirely and the form behaves exactly as before. The direct email
// is never affected, so the form can never silently fail.
//   Optional env:  AGENT_INTAKE_SECRET  (the agent's CHAT_WEBHOOK_SECRET; the gate)
//                  AGENT_INTAKE_URL     (default https://golman-agent.vercel.app/api/intake)
// We pass notifyOwner:false so Alex isn't double-notified — the direct email already
// reaches him; the agent only handles the visitor-facing auto-reply.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort hand-off to the AI agent for the visitor acknowledgment. Never throws;
// failures are logged and swallowed so the form response is unaffected. A short
// timeout keeps a slow/down agent from hanging the form.
async function notifyAgent({ name, email, category, message, subject }) {
  const secret = process.env.AGENT_INTAKE_SECRET;
  if (!secret) return; // not configured → skip silently (form behaves as before)
  const url = process.env.AGENT_INTAKE_URL || 'https://golman-agent.vercel.app/api/intake';

  const text = [
    '[GU-INTAKE v1]',
    `NAME: ${name}`,
    `EMAIL: ${email}`,
    `CATEGORY: ${category || '(none)'}`,
    `MESSAGE: ${message}`,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
      body: JSON.stringify({ from: `${name} <${email}>`, subject, text, notifyOwner: false }),
      signal: controller.signal,
    });
    if (!r.ok) console.error('contact: agent intake non-ok', r.status);
  } catch (err) {
    console.error('contact: agent intake error', err.name === 'AbortError' ? 'timeout' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Strip CR/LF/control chars so user input can't inject email headers.
const oneLine = (v) =>
  (v == null ? '' : String(v)).replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim();
// Keep newlines for the message body; drop other control chars.
const multiLine = (v) =>
  (v == null ? '' : String(v)).replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();

function parseBody(req) {
  let b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); }
    catch { return Object.fromEntries(new URLSearchParams(b)); }
  }
  return b;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const b = parseBody(req);

  // Honeypot: a hidden field humans never fill. If set, look successful and send nothing.
  if (oneLine(b._gotcha)) return res.status(200).json({ ok: true });

  const name = oneLine(b.name).slice(0, 200);
  const email = oneLine(b.Email || b.email).slice(0, 254);
  const category = oneLine(b.Category || b.category).slice(0, 100);
  const message = multiLine(b.Message || b.message).slice(0, 8000);

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email_invalid' });
  if (!message) return res.status(400).json({ error: 'message_required' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('contact: RESEND_API_KEY not set');
    return res.status(500).json({ error: 'not_configured' });
  }
  const to = process.env.CONTACT_TO || 'alexander@golmanuniversal.com';
  const from = process.env.CONTACT_FROM || 'Golman Universal <noreply@golmanuniversal.com>';

  const subject = `New inquiry${category ? ' — ' + category : ''} from ${name}`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Category: ${category || '(none)'}`,
    '',
    message,
    '',
    '— sent from the golmanuniversal.com contact form',
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: email, subject, text }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('contact: resend failed', r.status, detail);
      return res.status(502).json({ error: 'send_failed' });
    }
    // Direct email to Alex is sent (the guaranteed record). Best-effort: have the AI
    // agent send the visitor an instant acknowledgment. Awaited so the serverless
    // function doesn't freeze mid-call, but it never affects this 200 response.
    await notifyAgent({ name, email, category, message, subject });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact: send error', err);
    return res.status(500).json({ error: 'send_failed' });
  }
};
