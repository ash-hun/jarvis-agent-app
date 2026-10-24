// 서버 주소와 접근 키를 보관하고, 그 값으로 REST 와 WebSocket 주소를 만든다.

export type Connection = { server: string; token: string };

const STORAGE_KEY = 'jarvis_connection';

// ponytail: 키를 localStorage 에 둔다, 기기 분실이 걱정되거나 키가 여럿이 되면 Keychain 플러그인으로
export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { server = '', token = '' } = JSON.parse(raw);
      return { server, token };
    }
  } catch {
    // 깨진 값은 빈 설정으로 본다. 설정 화면에서 다시 저장하면 덮인다
  }
  return { server: '', token: '' };
}

export function saveConnection(conn: Connection): Connection {
  const clean = { server: normalizeServer(conn.server), token: conn.token.trim() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

// 사용자가 끝 슬래시나 공백을 붙여 넣어도 같은 주소가 되게 한다. 스킴이 없으면 https(Tailscale serve)로 본다
export function normalizeServer(server: string): string {
  const s = server.trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

// server 가 비어 있으면 페이지와 같은 출처(개발 서버 프록시)로 보낸다
export function apiUrl(conn: Connection, path: string): string {
  return `${conn.server}${path}`;
}

export function wsUrl(conn: Connection, sessionId: string, pageOrigin: string): string {
  const base = (conn.server || pageOrigin).replace(/^http/, 'ws');
  const qs = new URLSearchParams({ session_id: sessionId });
  if (conn.token) qs.set('token', conn.token);
  return `${base}/ws?${qs}`;
}

export function authHeaders(conn: Connection): Record<string, string> {
  return conn.token ? { Authorization: `Bearer ${conn.token}` } : {};
}
