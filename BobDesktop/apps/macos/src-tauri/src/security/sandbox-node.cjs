// Bob asks Node for system CAs at startup. Some Node/macOS combinations crash
// when the Keychain is denied by Seatbelt. Use Node's bundled public roots
// instead; do not disable TLS verification or expose the user's Keychain.
const tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
if (typeof tls.getCACertificates === 'function') {
  const original = tls.getCACertificates;
  tls.getCACertificates = function(type) {
    if (type === 'system') return [...tls.rootCertificates];
    return original.call(tls, type);
  };
  syncBuiltinESMExports();
}
