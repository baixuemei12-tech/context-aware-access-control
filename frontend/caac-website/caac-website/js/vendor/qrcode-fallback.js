/*
 * QRCode fallback — only activates if the real qrcode.min.js failed to load.
 * Shows a generic message instead of leaking the provisioning URI.
 */
(function () {
  if (typeof window.QRCode !== 'undefined') return;

  function QRCodeStub(container, opts) {
    if (!container) return;
    container.innerHTML =
      '<div style="padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--text2);font-size:11px;text-align:center;max-width:240px">' +
      'QR code unavailable. Use the secret code below to set up your authenticator.' +
      '</div>';
  }

  QRCodeStub.CorrectLevel = { M: 0 };
  window.QRCode = QRCodeStub;
})();
