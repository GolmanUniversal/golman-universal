/* Golman Universal — on-site chat widget (vanilla JS, no dependencies).
 *
 * Talks to the same-origin proxy at /api/chat (which holds the secret server-side
 * and forwards to the AI agent). Plain-text rendering only. Self-initializes on
 * DOMContentLoaded — to enable, add ONE line near the end of <body> on the pages
 * you want it:
 *
 *     <script src="/chat-widget.js" defer></script>
 *
 * Until CHAT_WEBHOOK_SECRET is set on the site's Vercel project, the proxy returns a
 * friendly "use the contact form" fallback, so the widget never appears broken.
 */
(function () {
  'use strict';
  if (window.__guChatLoaded) return;
  window.__guChatLoaded = true;

  // Derive the page lane from the path so the agent knows where the visitor is.
  function laneFromPath() {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('design-audit') !== -1) return 'audit';
    if (p.indexOf('service') !== -1) return 'services';
    if (p.indexOf('project') !== -1) return 'projects';
    if (p.indexOf('about') !== -1) return 'about';
    if (p.indexOf('contact') !== -1) return 'contact';
    return 'home';
  }

  var sessionId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sess-' + String(Date.now()) + '-' + Math.floor(Math.random() * 1e9);
  var lane = laneFromPath();
  var busy = false;

  var css = [
    '.gu-chat-btn{position:fixed;right:20px;bottom:20px;z-index:9998;background:#1a1a1a;color:#fff;border:none;border-radius:999px;padding:12px 18px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}',
    '.gu-chat-panel{position:fixed;right:20px;bottom:72px;z-index:9999;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 110px);background:#fff;border:1px solid #e3e3e0;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden;font:14px/1.45 system-ui,sans-serif;color:#1a1a1a}',
    '.gu-chat-panel.open{display:flex}',
    '.gu-chat-head{padding:12px 14px;border-bottom:1px solid #eee;font-weight:600}',
    '.gu-chat-head small{display:block;font-weight:400;color:#777;margin-top:2px}',
    '.gu-chat-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
    '.gu-msg{white-space:pre-wrap;padding:8px 11px;border-radius:10px;max-width:85%}',
    '.gu-msg.them{background:#f1f1ee;align-self:flex-start}',
    '.gu-msg.you{background:#1a1a1a;color:#fff;align-self:flex-end}',
    '.gu-chat-form{display:flex;border-top:1px solid #eee}',
    '.gu-chat-form textarea{flex:1;border:none;resize:none;padding:11px 13px;font:14px system-ui,sans-serif;outline:none;height:44px}',
    '.gu-chat-form button{border:none;background:#1a1a1a;color:#fff;padding:0 16px;cursor:pointer;font-weight:600}',
    '.gu-chat-form button:disabled{opacity:.5;cursor:default}'
  ].join('');

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function init() {
    var style = el('style'); style.textContent = css; document.head.appendChild(style);

    var btn = el('button', 'gu-chat-btn', 'Ask a question');
    var panel = el('div', 'gu-chat-panel');
    var head = el('div', 'gu-chat-head', 'Golman Universal');
    head.appendChild(el('small', null, 'Ask about a project, an audit, or the work.'));
    var log = el('div', 'gu-chat-log');
    var form = el('form', 'gu-chat-form');
    var input = el('textarea'); input.placeholder = 'Type a message…'; input.rows = 1;
    var send = el('button', null, 'Send'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    panel.appendChild(head); panel.appendChild(log); panel.appendChild(form);
    document.body.appendChild(btn); document.body.appendChild(panel);

    function addMsg(text, who) { var m = el('div', 'gu-msg ' + who, text); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; }

    var greeted = false;
    btn.addEventListener('click', function () {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        if (!greeted) { addMsg("Hi — what are you working on? Happy to point you to the right place.", 'them'); greeted = true; }
        input.focus();
      }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var text = input.value.trim();
      if (!text || busy) return;
      addMsg(text, 'you');
      input.value = '';
      busy = true; send.disabled = true;
      var thinking = addMsg('…', 'them');

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, message: text, lane: lane })
      }).then(function (r) { return r.json(); }).then(function (data) {
        thinking.textContent = data && data.reply
          ? data.reply
          : (data && data.degraded
              ? "We've hit today's chat limit — please use the contact form at /contact and Alex will follow up."
              : "Something went wrong. Please use the contact form at /contact.");
      }).catch(function () {
        thinking.textContent = "Something went wrong. Please use the contact form at /contact.";
      }).finally(function () { busy = false; send.disabled = false; log.scrollTop = log.scrollHeight; });
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
