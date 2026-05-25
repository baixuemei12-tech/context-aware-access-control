export function runLegacy(code, label) {
  // Bridge existing global scripts into Vite without rewriting every inline handler.
  const sourceUrl = label ? `\n//# sourceURL=${label}` : '';
  (0, eval)(`${code}${sourceUrl}`);
}

export function runLegacyStack(items) {
  const combined = items
    .map(([label, code]) => `\n/* ${label || 'legacy-script'} */\n${code}`)
    .join('\n');
  runLegacy(combined, 'caac-legacy-stack.js');
}
