/** URLs are credentials for invoices; query strings may contain tokens or PII. */
export function safeRequestPath(req) {
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  return path.replace(/(\/api\/invoice\/)[^/]+/gi, '$1[REDACTED]');
}

export function redactText(value, secrets = []) {
  if (typeof value !== 'string') return value;
  let text = value
    .replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/((?:token|password|secret|pin|api[_-]?key)=)[^\s&#]+/gi, '$1[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(\/api\/invoice\/)[^\s/?]+/gi, '$1[REDACTED]');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}
