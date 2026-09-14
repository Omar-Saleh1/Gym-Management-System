import { Request, Response } from 'express';
import { getLatestQrDataUrl, getWhatsAppStatus, restartWhatsApp, initWhatsAppClient } from '../services/whatsapp.service';

function wantsJson(req: Request): boolean {
  if (req.query.format === 'json') return true;
  const accept = req.headers.accept || '';
  return accept.includes('application/json');
}

/** GET /api/whatsapp/status */
export const getStatus = (_req: Request, res: Response) => {
  res.json(getWhatsAppStatus());
};

/** GET /api/whatsapp/restart */
export const restartSession = async (_req: Request, res: Response) => {
  await restartWhatsApp();
  if (wantsJson(_req)) {
    return res.json({ success: true, message: 'WhatsApp restarted' });
  }
  res.redirect('/api/whatsapp/qr');
};

/** GET /api/whatsapp/qr */
export const getQrPage = async (req: Request, res: Response) => {
  if (req.query.restart === '1' || req.query.restart === 'true') {
    await restartWhatsApp();
    return res.redirect('/api/whatsapp/qr');
  }

  const statusInfo = getWhatsAppStatus();
  let qrDataUrl = getLatestQrDataUrl();

  if (!statusInfo.connected && !qrDataUrl) {
    initWhatsAppClient();
  }

  if (statusInfo.connected) {
    const payload = {
      ready: true,
      authenticated: true,
      statusMessage: statusInfo.status,
      message: 'واتساب متصل بالنظام بنجاح ✅',
    };
    return wantsJson(req) ? res.json(payload) : res.send(renderConnectedPage());
  }

  if (!qrDataUrl) {
    if (wantsJson(req)) {
      return res.json({
        ready: false,
        authenticated: false,
        statusMessage: statusInfo.status,
        message: 'جاري تجهيز كود الـ QR، برجاء الانتظار ثوانٍ...',
      });
    }
    return res.send(renderWaitingPage(statusInfo.status || 'جاري تجهيز كود الـ QR...'));
  }

  if (wantsJson(req)) {
    return res.json({
      ready: false,
      authenticated: false,
      statusMessage: statusInfo.status,
      qrDataUrl,
    });
  }

  res.send(renderQrPage(qrDataUrl));
};

// ─── Modern Arabic HTML Pages ──────────────────────────────────────────────────

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
        
        if (data.connected) {
          if (qrBox) qrBox.style.display = 'none';
          if (successBox) successBox.style.display = 'block';
          if (statusEl) statusEl.textContent = 'متصل بنجاح ✅';
          document.title = 'واتساب متصل ✅';
          setTimeout(() => window.location.reload(), 2000);
          return;
        }

        if (statusEl && data.status) {
          statusEl.textContent = data.status === 'qr_ready' ? 'بانتظار المسح...' : data.status;
        }
      } catch (_) { /* ignore */ }
      setTimeout(poll, 2500);
    }

    poll();
  })();
</script>`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | VACUUM GYM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 30px 16px;
      background: #0f1117; color: #f3f4f6;
      display: flex; justify-content: center; align-items: center; min-height: 100vh;
    }
    .card {
      background: #181b24; border-radius: 24px; padding: 32px 24px;
      max-width: 440px; width: 100%; text-align: center;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.4rem; font-weight: 900; margin-bottom: 12px; color: #fff; }
    p { color: #9ca3af; margin: 8px 0; font-size: 0.95rem; line-height: 1.6; }
    .hint { font-size: 0.85rem; color: #6b7280; margin-top: 14px; }
    img.qr {
      width: min(280px, 75vw); height: auto;
      border: 4px solid #22c55e; border-radius: 16px;
      margin: 18px auto; display: block;
      background: #fff; padding: 10px;
      box-shadow: 0 8px 30px rgba(34, 197, 94, 0.25);
    }
    .status {
      display: inline-block; margin-top: 14px; padding: 6px 16px;
      background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 20px; font-size: 0.85rem; font-weight: 700;
    }
    .status.waiting {
      background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);
    }
    .success-icon { font-size: 3.5rem; margin: 12px 0; }
    .steps {
      text-align: right; margin: 18px 0; padding: 14px 18px;
      background: rgba(255,255,255,0.03); border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.05); color: #d1d5db; font-size: 0.9rem;
    }
    .steps ol { padding-right: 20px; }
    .steps li { margin: 8px 0; line-height: 1.5; }
    .btn-restart {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      margin-top: 16px; padding: 10px 20px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; color: #d1d5db; font-family: inherit; font-size: 0.9rem;
      font-weight: 700; cursor: pointer; text-decoration: none;
      transition: all 0.2s ease;
    }
    .btn-restart:hover {
      background: rgba(255,255,255,0.12); color: #fff;
    }
    .loader {
      width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.1);
      border-top-color: #22c55e; border-radius: 50%;
      animation: spin .8s linear infinite; margin: 24px auto;
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
  return pageShell('واتساب متصل', `
    <div class="success-icon">✅</div>
    <h1>واتساب متصل بالنظام بنجاح</h1>
    <p>النظام جاهز الآن لإرسال إشعارات الحضور وتجديد الاشتراكات ورسائل الترحيب للعملاء.</p>
    <span class="status">متصل وجاهز</span>
    <div style="margin-top: 24px;">
      <a href="/api/whatsapp/restart" class="btn-restart" style="color: #f87171; border-color: rgba(239,68,68,0.3);">
        🔄 تسجيل الخروج وإعادة الربط برقم آخر
      </a>
    </div>
  `);
}

function renderWaitingPage(message: string): string {
  return pageShell('جاري تجهيز الكود...', `
    <div class="loader"></div>
    <h1>جاري تجهيز كود الواتساب...</h1>
    <p id="status-text">${message}</p>
    <span class="status waiting">يرجى الانتظار بضع ثوانٍ</span>
    <div style="margin-top: 20px;">
      <a href="/api/whatsapp/qr?restart=1" class="btn-restart">
        🔄 إعادة المحاولة الآن
      </a>
    </div>
    <div id="success-box" style="display:none; margin-top:20px;">
      <div class="success-icon">✅</div>
      <h1>تم الاتصال بنجاح!</h1>
    </div>
  `);
}

function renderQrPage(qrDataUrl: string): string {
  return pageShell('ربط واتساب النظام', `
    <h1>📲 ربط واتساب بنظام الجيم</h1>
    
    <div class="steps">
      <ol>
        <li>افتح تطبيق <strong>WhatsApp</strong> على هاتفك.</li>
        <li>اضغط على <strong>القائمة (⋮)</strong> أو <strong>الإعدادات</strong>.</li>
        <li>اختر <strong>«الأجهزة المرتبطة» (Linked Devices)</strong>.</li>
        <li>اضغط على <strong>«ربط جهاز»</strong> ووجّه الكاميرا نحو الكود:</li>
      </ol>
    </div>

    <div id="qr-box">
      <img class="qr" src="${qrDataUrl}" alt="WhatsApp QR Code" />
    </div>

    <div id="success-box" style="display:none">
      <div class="success-icon">✅</div>
      <h1>تم ربط الواتساب بنجاح!</h1>
      <p>جاري تحديث الصفحة...</p>
    </div>

    <div>
      <span class="status waiting" id="status-text">بانتظار المسح من الهاتف...</span>
    </div>

    <div style="margin-top: 16px;">
      <a href="/api/whatsapp/qr?restart=1" class="btn-restart">
        🔄 كود جديد / إعادة تشغيل
      </a>
    </div>
  `);
}

