/* Local development overrides.
   Production pages keep using the same host as the website. */
(function () {
  const host = window.location && window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    window.CAAC_GATEWAY_URL = '';
  }
})();
