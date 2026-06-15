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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact: send error', err);
    return res.status(500).json({ error: 'send_failed' });
  }
};
