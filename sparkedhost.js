import WebSocket from 'ws';

const DEFAULT_PANEL_URL = 'https://control.sparkedhost.us';
const DEFAULT_API_PREFIX = '/api/client/servers';

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function ensureLeadingSlash(value) {
  const text = String(value || '').trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

function requireEnv(name, fallback = null) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  const panelUrl = trimSlash(process.env.SPARKEDHOST_PANEL_URL || DEFAULT_PANEL_URL);
  const serverId = requireEnv('SPARKEDHOST_SERVER_ID');
  const apiKey = requireEnv('SPARKEDHOST_API_KEY');

  return {
    panelUrl,
    serverId,
    apiKey,
    apiPrefix: ensureLeadingSlash(process.env.SPARKEDHOST_API_PREFIX || DEFAULT_API_PREFIX),
    authHeaderName: process.env.SPARKEDHOST_AUTH_HEADER_NAME || 'Authorization',
    authHeaderValue: process.env.SPARKEDHOST_AUTH_HEADER_VALUE || `Bearer ${apiKey}`,
    commandTimeoutMs: asInt(process.env.COMMAND_TIMEOUT_MS, 15000),
    consoleSnapshotMs: asInt(process.env.CONSOLE_SNAPSHOT_MS, 2500),
    maxOutputBytes: asInt(process.env.MAX_OUTPUT_BYTES, 250000),
    maxLogLines: asInt(process.env.MAX_LOG_LINES, 200)
  };
}

export function apiBaseUrl(config) {
  return `${config.panelUrl}${config.apiPrefix}/${config.serverId}`;
}

export function apiUrl(config, path = '') {
  const suffix = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl(config)}${suffix}`;
}

export function authHeaders(config) {
  return {
    [config.authHeaderName]: config.authHeaderValue,
    Accept: 'application/json'
  };
}

export async function apiRequest(config, path, init = {}) {
  const url = apiUrl(config, path);
  const headers = new Headers(init.headers || {});
  const baseHeaders = authHeaders(config);
  for (const [key, value] of Object.entries(baseHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
  }

  const controller = init.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), config.commandTimeoutMs) : null;

  try {
    const response = await fetch(url, { ...init, headers, signal: init.signal || controller?.signal });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let parsed = text;
    if (contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const error = new Error(`SparkedHost API ${response.status} ${response.statusText} at ${path}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
      error.response = parsed;
      error.status = response.status;
      throw error;
    }

    return parsed;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function tryApiRequests(config, attempts) {
  let lastError;
  for (const attempt of attempts) {
    try {
      return await apiRequest(config, attempt.path, attempt.init);
    } catch (error) {
      lastError = error;
      if (error?.status !== 404) {
        break;
      }
    }
  }
  throw lastError || new Error('All API attempts failed');
}

export async function listFiles(config, directory = '/') {
  const dir = directory || '/';
  return apiRequest(
    config,
    `/files/list?directory=${encodeURIComponent(dir)}`,
    { method: 'GET' }
  );
}

export async function readFile(config, file) {
  return tryApiRequests(config, [
    { path: `/files/contents?file=${encodeURIComponent(file)}`, init: { method: 'GET' } },
    { path: `/files/contents?path=${encodeURIComponent(file)}`, init: { method: 'GET' } }
  ]);
}

export async function writeFile(config, file, content) {
  return tryApiRequests(config, [
    {
      path: `/files/write?file=${encodeURIComponent(file)}`,
      init: { method: 'POST', body: content }
    },
    {
      path: `/files/write?path=${encodeURIComponent(file)}`,
      init: { method: 'POST', body: content }
    },
    {
      path: '/files/write',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, content })
      }
    },
    {
      path: '/files/write',
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, content })
      }
    }
  ]);
}

export async function renameFile(config, from, to) {
  return tryApiRequests(config, [
    {
      path: '/files/rename',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to })
      }
    },
    {
      path: '/files/rename',
      init: {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to })
      }
    }
  ]);
}

export async function deleteFiles(config, files) {
  const list = Array.isArray(files) ? files : [files];
  return tryApiRequests(config, [
    {
      path: '/files/delete',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: list })
      }
    },
    {
      path: `/files/delete?files=${encodeURIComponent(list.join(','))}`,
      init: { method: 'DELETE' }
    },
    {
      path: '/files/delete',
      init: {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: list })
      }
    }
  ]);
}

export async function runCommand(config, command) {
  return tryApiRequests(config, [
    {
      path: '/command',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      }
    },
    {
      path: '/console/command',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      }
    }
  ]);
}

export async function restartServer(config) {
  return tryApiRequests(config, [
    {
      path: '/power',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal: 'restart' })
      }
    },
    {
      path: '/power/restart',
      init: { method: 'POST' }
    }
  ]);
}

export async function getStatistics(config) {
  const response = await tryApiRequests(config, [
    { path: '', init: { method: 'GET' } },
    { path: '/resources', init: { method: 'GET' } },
    { path: '/stats', init: { method: 'GET' } }
  ]);

  const attributes = response?.attributes || response?.data?.attributes || response?.data || response || {};
  const resources = attributes.resources || response?.resources || {};

  return {
    raw: response,
    status: attributes.current_state || attributes.status || response?.status || null,
    isSuspended: attributes.is_suspended ?? response?.is_suspended ?? null,
    cpuPercent: resources.cpu_absolute ?? resources.cpu ?? attributes.cpu_absolute ?? null,
    memoryBytes: resources.memory_bytes ?? resources.memory ?? null,
    memoryPercent: resources.memory_percent ?? null,
    diskBytes: resources.disk_bytes ?? resources.disk ?? null,
    networkRxBytes: resources.network_rx_bytes ?? null,
    networkTxBytes: resources.network_tx_bytes ?? null,
    uptimeSeconds: resources.uptime ?? attributes.uptime_seconds ?? null
  };
}

function stripAnsi(input) {
  return String(input || '').replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, '');
}

function parseWebsocketPayload(payload) {
  const text = String(payload || '');
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function getConsoleSnapshot(config, { durationMs = config.consoleSnapshotMs, maxLines = config.maxLogLines } = {}) {
  const response = await tryApiRequests(config, [
    { path: '/websocket', init: { method: 'GET' } },
    { path: '/console/websocket', init: { method: 'GET' } }
  ]);

  const socketUrl = response?.data?.socket || response?.data?.url || response?.socket || response?.url;
  const token = response?.data?.token || response?.token;

  if (!socketUrl || !token) {
    throw new Error(`Could not find websocket socket/token in response: ${JSON.stringify(response)}`);
  }

  const lines = [];
  const events = [];

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl, { rejectUnauthorized: true });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      finish();
    }, durationMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ event: 'auth', args: [token] }));
    });

    ws.on('message', message => {
      const text = stripAnsi(message.toString());
      events.push(text);
      const payload = parseWebsocketPayload(text);
      const eventName = payload.event || payload?.raw?.event;
      const args = payload.args || payload?.raw?.args || [];

      if (eventName === 'console output' && typeof args[0] === 'string') {
        lines.push(args[0]);
      } else if (eventName === 'console output' && payload?.raw) {
        lines.push(String(payload.raw));
      } else if (typeof payload?.raw === 'string') {
        lines.push(payload.raw);
      }

      if (lines.length > maxLines) {
        lines.splice(0, lines.length - maxLines);
      }
    });

    ws.on('error', reject);
    ws.on('close', () => {
      clearTimeout(timeout);
      finish();
    });
  });

  return { lines, events };
}

export function normalizeFileListing(response) {
  const rawList = response?.data || response?.files || response?.items || response?.contents || response;
  if (Array.isArray(rawList)) {
    return rawList.map(item => item?.attributes || item);
  }
  if (Array.isArray(response?.data?.data)) {
    return response.data.data.map(item => item?.attributes || item);
  }
  return response;
}
