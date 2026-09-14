// Loaded via NODE_OPTIONS --require inside the Seatbelt profile.
// 1) Bob asks Node for system CAs at startup. Some Node/macOS combinations
//    crash when the Keychain is denied. Use Node's bundled public roots.
// 2) `bob run` does not need filesystem watches. Native/JS watchers otherwise
//    walk the install tree until macOS's low GUI fd cap: EMFILE, watch.
// 3) IBM Bob's vscode-policy-watcher.node uses FSEvents directly and bypasses
//    fs.watch — stub it so Seatbelt sessions can start (Cowork-like: no host
//    policy/file watching outside the workspace).
// 4) Block private/LAN/link-local/cloud-metadata egress from Node (Seatbelt on
//    current macOS only accepts localhost/* hosts — no CIDR filters).
const fs = require('node:fs');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const tls = require('node:tls');
const net = require('node:net');
const dns = require('node:dns');
const { syncBuiltinESMExports } = require('node:module');

const SANDBOX_PRIVATE_NET_MSG =
  'Cette action est bloquée par les limitations de la sandbox Bob Work : pas d’accès au réseau local, aux adresses privées ni aux métadonnées cloud.';

function isBlockedIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const value = ip.split('%')[0].toLowerCase();
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isBlockedHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.local') || host === 'metadata.google.internal') {
    return true;
  }
  return isBlockedIp(host);
}

function privateNetError() {
  const error = new Error(SANDBOX_PRIVATE_NET_MSG);
  error.code = 'ENETUNREACH';
  return error;
}

function installPrivateNetworkGuards() {
  const originalLookup = dns.lookup;
  dns.lookup = function sandboxLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }
    if (isBlockedHostname(hostname)) {
      if (typeof callback === 'function') {
        process.nextTick(() => callback(privateNetError()));
        return;
      }
      throw privateNetError();
    }
    return originalLookup.call(this, hostname, options, function (err, address, family) {
      if (!err && isBlockedIp(address)) {
        callback(privateNetError());
        return;
      }
      callback(err, address, family);
    });
  };

  if (typeof dns.promises?.lookup === 'function') {
    const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
    dns.promises.lookup = async function sandboxPromiseLookup(hostname, options) {
      if (isBlockedHostname(hostname)) throw privateNetError();
      const result = await originalPromiseLookup(hostname, options);
      const address = typeof result === 'string' ? result : result && result.address;
      if (isBlockedIp(address)) throw privateNetError();
      return result;
    };
  }

  net.Socket.prototype.connect = (function (originalConnect) {
    return function sandboxConnect(...args) {
      let options = args[0];
      if (typeof options === 'string') {
        // connect(path) unix socket — allow (Chrome bridge).
        return originalConnect.apply(this, args);
      }
      if (typeof options === 'number') {
        const host = typeof args[1] === 'string' ? args[1] : 'localhost';
        if (isBlockedHostname(host)) {
          const error = privateNetError();
          process.nextTick(() => this.emit('error', error));
          return this;
        }
        return originalConnect.apply(this, args);
      }
      if (options && typeof options === 'object') {
        if (options.path) {
          return originalConnect.apply(this, args);
        }
        const host = options.host || options.hostname || 'localhost';
        if (isBlockedHostname(host)) {
          const error = privateNetError();
          process.nextTick(() => this.emit('error', error));
          return this;
        }
      }
      return originalConnect.apply(this, args);
    };
  })(net.Socket.prototype.connect);

  net.connect = function sandboxNetConnect(...args) {
    const socket = new net.Socket();
    return net.Socket.prototype.connect.apply(socket, args);
  };
  net.createConnection = net.connect;
}

installPrivateNetworkGuards();

class ClosedWatcher extends EventEmitter {
  close() {}
  ref() { return this; }
  unref() { return this; }
  start() { return this; }
  stop() { return this; }
  on() { return this; }
  once() { return this; }
  addListener() { return this; }
}

function isWatchBudgetError(error) {
  const message = error && error.message ? String(error.message) : String(error || '');
  return Boolean(
    error &&
      (error.code === 'EMFILE' ||
        error.code === 'ENFILE' ||
        (/too many open files/i.test(message) && /watch/i.test(message))),
  );
}

function watchDisabled() {
  return new ClosedWatcher();
}

function installFsWatchStubs() {
  fs.watch = watchDisabled;
  fs.watchFile = watchDisabled;
  if (fs.promises && typeof fs.promises.watch === 'function') {
    fs.promises.watch = async function promiseWatchDisabled() {
      return (async function* emptyWatch() {})();
    };
  }
  try {
    syncBuiltinESMExports();
  } catch {
    // ignore — older Node without the helper
  }
}

installFsWatchStubs();

// Stub native IBM policy watcher (and any similarly named .node watchers).
const originalLoad = Module._load;
Module._load = function sandboxLoad(request, parent, isMain) {
  const name = String(request || '');
  if (
    name.includes('vscode-policy-watcher') ||
    name.endsWith('vscode-policy-watcher.node')
  ) {
    return {
      createWatcher() {
        return new ClosedWatcher();
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

// Bob Shell installs its own uncaughtException handler that calls process.exit
// on EMFILE. Keep watch stubs installed and suppress that fatal exit for watch
// budget errors only — other fatals still terminate.
const realExit = process.exit.bind(process);
let suppressWatchExit = false;
process.exit = function sandboxExit(code) {
  if (suppressWatchExit && (code === 1 || code === undefined)) {
    suppressWatchExit = false;
    return undefined;
  }
  return realExit(code);
};

function ignoreWatchBudget(error) {
  if (!isWatchBudgetError(error)) return false;
  suppressWatchExit = true;
  setImmediate(() => {
    suppressWatchExit = false;
    installFsWatchStubs();
  });
  return true;
}

process.prependListener('uncaughtException', (error) => {
  if (ignoreWatchBudget(error)) return;
});
process.prependListener('unhandledRejection', (error) => {
  if (ignoreWatchBudget(error)) return;
});

// Re-assert stubs after Bob's startup finishes wiring chokidar / policy watchers.
for (const delay of [0, 50, 250, 1000, 3000]) {
  setTimeout(installFsWatchStubs, delay);
}

if (typeof tls.getCACertificates === 'function') {
  const original = tls.getCACertificates;
  tls.getCACertificates = function (type) {
    if (type === 'system') return [...tls.rootCertificates];
    return original.call(tls, type);
  };
}

syncBuiltinESMExports();
