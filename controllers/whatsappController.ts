import { Request, Response } from 'express';
import { getLatestQrDataUrl, getWhatsAppStatus } from '../services/whatsapp.service';

function wantsJson(req: Request): boolean {
  if (req.query.format === 'json') return true;
  const accept = req.headers.accept || '';
  return accept.includes('application/json');
}

/** GET /api/whatsapp/status */
export const getStatus = (_req: Request, res: Response) => {
  res.json(getWhatsAppStatus());
};

/** GET /api/whatsapp/qr — never creates a new client; reads cached QR/state only */
export const getQrPage = (req: Request, res: Response) => {
  const status = getWhatsAppStatus();
  const qrDataUrl = getLatestQrDataUrl();

  if (status.ready) {
    const payload = {
      ready: true,
      authenticated: true,
      statusMessage: 'ready',
      message: 'WhatsApp Connected Successfully',
    };
    return wantsJson(req) ? res.json(payload) : res.send(renderConnectedPage());
  }

  if (status.authenticated && !status.ready) {
    if (wantsJson(req)) {
      return res.json({
        ready: false,
        authenticated: true,
        statusMessage: status.statusMessage,
        message: 'Authenticated — waiting for ready...',
      });
    }
    return res.send(renderWaitingPage('Authenticated — connecting to WhatsApp...'));
  }

  if (!qrDataUrl) {
    if (wantsJson(req)) {
      return res.json({
        ready: false,
        authenticated: false,
        statusMessage: status.statusMessage,
        message: 'QR not ready yet — please wait',
      });
    }
    return res.send(renderWaitingPage(status.statusMessage || 'Preparing QR code...'));
  }

  if (wantsJson(req)) {
    return res.json({
      ready: false,
      authenticated: false,
      statusMessage: 'waiting_for_scan',
      qrDataUrl,
    });
  }

  res.send(renderQrPage(qrDataUrl));
};

// ─── HTML pages ──────────────────────────────────────────────────────────────

const STATUS_POLL_SCRIPT = `
<script>
  (function () {
    const statusEl = document.getElementById('status-text');
    const qrBox = document.getElementById('qr-box');
    const successBox = document.getElementById('success-box');

    async function poll() {
      try {
        const res = await fetch('/api/whatsapp/status', { cache: 'no-store' });
        const data = await res.json();
        if (statusEl) statusEl.textContent = data.statusMessage || 'unknown';

        if (data.ready) {
          if (qrBox) qrBox.style.display = 'none';
          if (successBox) successBox.style.display = 'block';
          document.title = 'WhatsApp Connected';
          return;
        }

        if (data.authenticated && !data.ready) {
          if (statusEl) statusEl.textContent = 'Authenticated — connecting...';
        }
      } catch (_) { /* ignore poll errors */ }
      setTimeout(poll, 3000);
    }

    poll();
  })();
</script>`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 24px 16px;
      background: #f0f2f5; color: #111;
      display: flex; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 28px 24px;
      max-width: 420px; width: 100%; text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
    }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    p  { color: #555; margin: 8px 0; line-height: 1.5; }
    .hint { font-size: .9rem; color: #888; }
    img.qr {
      width: min(320px, 80vw); height: auto;
      border: 4px solid #25D366; border-radius: 12px;
      margin: 16px auto; display: block;
    }
    .status {
      display: inline-block; margin-top: 12px; padding: 6px 14px;
      background: #e8f5e9; color: #2e7d32; border-radius: 20px;
      font-size: .85rem; font-weight: 600;
    }
    .success { color: #25D366; font-size: 3rem; margin: 12px 0; }
    .steps { text-align: left; margin: 16px 0; padding: 0 0 0 20px; color: #444; font-size: .95rem; }
    .steps li { margin: 6px 0; }
    .loader {
      width: 48px; height: 48px; border: 4px solid #e0e0e0;
      border-top-color: #25D366; border-radius: 50%;
      animation: spin .8s linear infinite; margin: 20px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">${body}</div>
  ${STATUS_POLL_SCRIPT}
</body>
</html>`;
}

function renderConnectedPage(): string {
  return pageShell('WhatsApp Connected', `
    <div class="success">✅</div>
    <h1>WhatsApp Connected Successfully</h1>
    <p>Messages can be sent now.</p>
    <span class="status">ready</span>
    <p class="hint"><a href="/api/whatsapp/status">View status (JSON)</a></p>
  `);
}

function renderWaitingPage(message: string): string {
  return pageShell('WhatsApp — Loading', `
    <div class="loader"></div>
    <h1>Please wait...</h1>
    <p id="status-text">${message}</p>
    <p class="hint">This page refreshes status automatically.</p>
    <div id="success-box" style="display:none">
      <div class="success">✅</div>
      <h1>WhatsApp Connected Successfully</h1>
    </div>
  `);
}

function renderQrPage(qrDataUrl: string): string {
  return pageShell('Scan WhatsApp QR', `
    <h1>Scan this QR with WhatsApp</h1>
    <ol class="steps">
      <li>Open WhatsApp on your phone</li>
      <li>Go to <strong>Linked Devices</strong></li>
      <li>Tap <strong>Link a Device</strong></li>
      <li>Scan the QR code below</li>
    </ol>
    <div id="qr-box">
      <img class="qr" src="${qrDataUrl}" alt="WhatsApp QR Code" />
    </div>
    <div id="success-box" style="display:none">
      <div class="success">✅</div>
      <h1>WhatsApp Connected Successfully</h1>
    </div>
    <span class="status" id="status-text">waiting_for_scan</span>
    <p class="hint">Status updates every 3 seconds</p>
  `);
}
