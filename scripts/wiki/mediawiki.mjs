import { assertPcSource } from './lua-data.mjs';
import { renderFieldRequest } from './normalize.mjs';

export const API_URL = 'https://wiki.leagueoflegends.com/en-us/api.php';
const USER_AGENT = 'LOL2D-Wiki-Importer/1.0 (offline game data tooling)';

function pageFrom(response, operation) {
  const page = response?.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`${operation}: page not found`);
  return page;
}

export function createMediaWikiClient({
  fetcher = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  throttleMs = 250,
  timeoutMs = 15_000,
  retries = 2,
} = {}) {
  let active = 0;
  let lastRequestAt = 0;
  const waiting = [];

  async function enter() {
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    active++;
    const wait = Math.max(0, throttleMs - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();
  }

  function leave() {
    active--;
    waiting.shift()?.();
  }

  async function request(params, binary = false) {
    await enter();
    try {
      const url = new URL(binary ? params.url : API_URL);
      if (!binary) {
        url.search = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
      }
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetcher(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: binary ? '*/*' : 'application/json' },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
          return binary ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        } catch (error) {
          if (attempt === retries) throw new Error(`League Wiki request failed: ${error instanceof Error ? error.message : error}`);
          await sleep(200 * (2 ** attempt));
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      leave();
    }
  }

  async function revision(title, content = false) {
    assertPcSource(title);
    const rvprop = content ? 'ids|timestamp|content' : 'ids|timestamp';
    const response = await request({ action: 'query', prop: 'revisions', titles: title, rvprop, rvslots: 'main' });
    const page = pageFrom(response, title);
    const item = page.revisions?.[0];
    if (!item?.revid) throw new Error(`${title}: revision unavailable`);
    return { page, item, response };
  }

  return {
    async fetchChampionIndex() {
      const title = 'Module:ChampionData/data';
      const { item } = await revision(title, true);
      const source = item.slots?.main?.content ?? item.content;
      if (typeof source !== 'string') throw new Error(`${title}: revision content unavailable`);
      return {
        source,
        revisionId: item.revid,
        timestamp: item.timestamp,
        pageUrl: 'https://wiki.leagueoflegends.com/en-us/Module:ChampionData/data',
      };
    },
    async fetchTemplate(page) {
      assertPcSource(page);
      const [{ item, response: revisionResponse }, expanded] = await Promise.all([
        revision(page),
        request({ action: 'expandtemplates', prop: 'wikitext', title: page, text: renderFieldRequest(page) }),
      ]);
      const fields = expanded?.expandtemplates?.wikitext;
      if (typeof fields !== 'string') throw new Error(`${page}: expanded fields unavailable`);
      return {
        page,
        revisionId: item.revid,
        timestamp: item.timestamp,
        fields,
        raw: { revision: revisionResponse, expanded },
        pageUrl: `https://wiki.leagueoflegends.com/en-us/${page.replaceAll(' ', '_')}`,
      };
    },
    async fetchImageInfo(file) {
      const title = file.startsWith('File:') ? file : `File:${file}`;
      const response = await request({ action: 'query', prop: 'imageinfo', titles: title, iiprop: 'url|sha1|mime' });
      const info = pageFrom(response, title).imageinfo?.[0];
      if (!info?.url || !info.mime) throw new Error(`${title}: original image URL unavailable`);
      return info;
    },
    fetchBytes(url) {
      return request({ url }, true);
    },
  };
}
