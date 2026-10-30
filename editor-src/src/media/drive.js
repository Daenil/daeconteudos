// Conversa com a API do Google Drive direto do navegador, usando o token temporário que o servidor
// entrega em openEditProject (só sai depois de checar a permissão do usuário).

// Mesmas regras do servidor (extractDriveFileId_ / extractDriveFolderId_ em Código.js).
export function parseDriveLink(link) {
  link = String(link || '').trim();
  let m = link.match(/\/file\/d\/([a-zA-Z0-9_-]{15,})/) || link.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  if (m) return { kind: 'file', id: m[1] };
  m = link.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]{15,})/);
  if (m) return { kind: 'folder', id: m[1] };
  return null;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';
const META_FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,videoMediaMetadata(width,height,durationMillis)';

export class DriveError extends Error {
  constructor(message, status) { super(message); this.name = 'DriveError'; this.status = status; }
}

function defaultSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function messageFor(status, what) {
  if (status === 401) return 'A sessão com o Drive expirou. Feche e abra o editor de novo.';
  if (status === 403) return 'O Drive recusou o acesso ' + what + ' (limite de uso ou sem permissão). Espere alguns minutos e tente de novo.';
  if (status === 404) return 'Não encontrei ' + what + ' no Drive (foi apagado ou a conta não tem acesso).';
  if (status === 429) return 'O Drive pediu para ir mais devagar. Tente de novo em instantes.';
  return 'O Drive respondeu com erro ' + status + ' ao acessar ' + what + '.';
}

export class DriveClient {
  // getToken(forceRefresh) -> Promise<string>. Quando o Drive devolve 401 (token venceu) pedimos um
  // novo com forceRefresh=true e repetimos uma vez.
  constructor(opts) {
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetchImpl || function () { return fetch.apply(null, arguments); };
    this.sleep = opts.sleep || defaultSleep;
    this.retries = opts.retries == null ? 3 : opts.retries;
  }

  async _request(url, init, what) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        const token = await this.getToken(false);
        const headers = Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + token });
        res = await this.fetchImpl(url, Object.assign({}, init, { headers: headers }));
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (attempt >= this.retries) throw new DriveError('Sem conexão com o Drive. Verifique a internet e tente de novo.', 0);
        await this.sleep(500 * Math.pow(2, attempt));
        continue;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.getToken(true);
        continue;
      }
      if ((res.status >= 500 || res.status === 429) && attempt < this.retries) {
        await this.sleep(500 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok && res.status !== 206) throw new DriveError(messageFor(res.status, what), res.status);
      return res;
    }
  }

  async getMeta(id) {
    const res = await this._request(API + '/' + id + '?fields=' + encodeURIComponent(META_FIELDS) + '&supportsAllDrives=true', {}, 'o arquivo');
    return normalizeMeta(await res.json());
  }

  // Todos os itens de uma pasta cujo tipo começa com um dos prefixos (ex.: ['video/', 'audio/']).
  async listFolder(folderId, opts) {
    opts = opts || {};
    const prefixes = opts.mimePrefixes || ['video/', 'audio/'];
    const out = [];
    let pageToken = '';
    for (let page = 0; page < 20; page++) {
      const q = "'" + folderId + "' in parents and trashed=false";
      const url = API + '?q=' + encodeURIComponent(q) + '&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true' +
        '&fields=' + encodeURIComponent('nextPageToken,files(' + META_FIELDS + ')') + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const res = await this._request(url, {}, 'a pasta');
      const data = await res.json();
      (data.files || []).forEach(function (f) {
        if (prefixes.some(function (p) { return (f.mimeType || '').indexOf(p) === 0; })) out.push(normalizeMeta(f));
      });
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }

  // Bytes [start, endInclusive] do arquivo.
  async fetchRange(id, start, endInclusive, signal) {
    const res = await this._request(API + '/' + id + '?alt=media&supportsAllDrives=true', {
      headers: { Range: 'bytes=' + start + '-' + endInclusive }, signal: signal
    }, 'o vídeo');
    const buf = new Uint8Array(await res.arrayBuffer());
    // Se o servidor ignorou o Range e mandou o arquivo todo (200), recorta o pedaço pedido.
    if (res.status === 200 && (start > 0 || buf.length > endInclusive - start + 1)) return buf.subarray(start, endInclusive + 1);
    return buf;
  }
}

export function normalizeMeta(f) {
  const vm = f.videoMediaMetadata || {};
  return {
    id: f.id,
    name: f.name || '',
    mimeType: f.mimeType || '',
    isFolder: f.mimeType === FOLDER_MIME,
    size: f.size == null ? null : Number(f.size),
    md5Checksum: f.md5Checksum || '',
    modifiedTime: f.modifiedTime || '',
    width: vm.width || null,
    height: vm.height || null,
    durationUs: vm.durationMillis != null ? Number(vm.durationMillis) * 1000 : null
  };
}
