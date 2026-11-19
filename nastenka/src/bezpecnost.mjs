// Podpisy webhooků, šifrování tokenů a cookies. Jen WebCrypto, běží ve Workeru i v Node 20+.

const kodovac = new TextEncoder();
const hex = (bajty) => [...new Uint8Array(bajty)].map((b) => b.toString(16).padStart(2, '0')).join('');
const zB64 = (text) => Uint8Array.from(atob(text), (z) => z.charCodeAt(0));
const doB64 = (bajty) => btoa(String.fromCharCode(...new Uint8Array(bajty)));

// Porovnání v konstantním čase, aby se podpis nedal hádat po znacích podle doby odpovědi.
export function stejne(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let rozdil = 0;
  for (let i = 0; i < a.length; i++) rozdil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdil === 0;
}

export async function hmacHex(tajemstvi, text) {
  const klic = await crypto.subtle.importKey('raw', kodovac.encode(tajemstvi), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', klic, kodovac.encode(text)));
}

// Hlavička X-Hub-Signature-256 = "sha256=" + HMAC těla tajemstvím webhooku.
export async function overPodpisWebhooku(tajemstvi, telo, hlavicka) {
  if (!tajemstvi || !hlavicka?.startsWith('sha256=')) return false;
  return stejne(`sha256=${await hmacHex(tajemstvi, telo)}`, hlavicka);
}

export const nahodneId = (bajtu = 32) => hex(crypto.getRandomValues(new Uint8Array(bajtu)));

// Tokeny v D1 jsou zašifrované AES-GCM klíčem ze secret SESSION_KEY (32 bajtů v base64).
async function klicSifry(klicB64) {
  const surovy = zB64(klicB64);
  if (surovy.length !== 32) throw new Error('SESSION_KEY musí být 32 bajtů v base64.');
  return crypto.subtle.importKey('raw', surovy, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function zasifruj(klicB64, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sifra = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await klicSifry(klicB64), kodovac.encode(text));
  return `${doB64(iv)}.${doB64(sifra)}`;
}

export async function desifruj(klicB64, ulozene) {
  const [iv, sifra] = ulozene.split('.');
  const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: zB64(iv) }, await klicSifry(klicB64), zB64(sifra));
  return new TextDecoder().decode(text);
}

export function cookies(request) {
  const vysledek = {};
  for (const cast of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = cast.indexOf('=');
    if (i > 0) vysledek[cast.slice(0, i).trim()] = cast.slice(i + 1).trim();
  }
  return vysledek;
}

export const cookie = (nazev, hodnota, maxAge) =>
  `${nazev}=${hodnota}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Seznam povolených účtů z proměnné VLASTNICI („login1, login2“). Logins na GitHubu nerozlišují velikost písmen.
export const seznamVlastniku = (text) => (text ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const jeVlastnik = (login, text) => seznamVlastniku(text).includes(String(login ?? '').toLowerCase());
