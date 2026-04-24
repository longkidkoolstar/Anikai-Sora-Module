// =============================================
// AnimeKai (anikai.to) — Sora/Sulfur Module
// Author : longkidkoolstar
// Version: 1.0.0
// =============================================

const BASE_URL  = "https://anikai.to";
const ENC_API   = "https://enc-dec.app/api";

// ── Helpers ──────────────────────────────────

/**
 * Encode a string via the AnimeKai enc-dec service.
 * The `_` query-parameter in every AJAX call is this value.
 */
async function _enc(text) {
  const res  = await fetch(`${ENC_API}/enc-movies-flix?text=${encodeURIComponent(text)}`);
  const data = await res.json();
  return data.result;
}

/**
 * Decode an encrypted string (server returns encrypted iframe URLs).
 */
async function _dec(text) {
  const res  = await fetch(`${ENC_API}/dec-movies-flix?text=${encodeURIComponent(text)}`);
  const data = await res.json();
  return data.result;
}

/** Tiny DOM parser helper so the module works inside Sora's JS sandbox. */
function _parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Extract the first m3u8 URL buried inside a player page's HTML / JS. */
function _findM3U8(html) {
  // Explicit .m3u8 href
  const direct = html.match(/["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*)[`"']/);
  if (direct) return direct[1];

  // JWPlayer / Video.js file key
  const file = html.match(/['"](file|src)['"]\s*[:]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
  if (file) return file[2];

  // sources array
  const src = html.match(/sources\s*[:=]\s*\[[^\]]*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
  if (src) return src[1];

  return null;
}

// ── Sora interface functions ──────────────────

/**
 * SEARCH
 * Called when the user types a query.
 * Must return: [{title, image, href}]
 */
async function searchResults(query) {
  const url  = `${BASE_URL}/browser?keyword=${encodeURIComponent(query)}`;
  const res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  const html = await res.text();
  const doc  = _parse(html);

  const results = [];

  // AnimeKai uses .item cards inside .film_list-wrap / .anilist-wrap
  const cards = doc.querySelectorAll(
    ".film_list-wrap .flw-item, .aitem, [class*='ani'] .item, .anilist-wrap .item"
  );

  cards.forEach(card => {
    const a     = card.querySelector("a.film-poster-ahref, a[href*='/watch/'], a");
    const img   = card.querySelector("img.film-poster-img, img[data-src], img");
    const nameEl= card.querySelector(".film-name a, .name, .title, h3 a, h2 a");

    const href  = a?.getAttribute("href") || "";
    const title = nameEl?.textContent?.trim()
               || a?.getAttribute("title")
               || "";
    const image = img?.getAttribute("data-src") || img?.getAttribute("src") || "";

    if (title && href) {
      results.push({
        title,
        image: image.startsWith("http") ? image : `${BASE_URL}${image}`,
        href : href.startsWith("http")  ? href  : `${BASE_URL}${href}`
      });
    }
  });

  return results;
}

/**
 * DETAILS
 * Called when the user taps on a search result.
 * Must return: [{description, aliases, airdate}]
 */
async function extractDetails(url) {
  const res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  const html = await res.text();
  const doc  = _parse(html);

  const description =
    doc.querySelector(".film-description .text, .description, .synopsis, [class*='desc']")
       ?.textContent?.trim() || "";

  const genres =
    Array.from(doc.querySelectorAll(".item-list a, .genres a, [class*='genre'] a"))
         .map(g => g.textContent.trim())
         .filter(Boolean)
         .join(", ");

  const airdate =
    doc.querySelector("[class*='premiered'], [class*='aired'], .item-title:last-of-type")
       ?.textContent?.trim() || "";

  return [{
    description,
    aliases : genres,
    airdate
  }];
}

/**
 * EPISODES
 * Called after details load.
 * Must return: [{number, href}]
 *
 * href carries the watch-path + token so extractStreamUrl can work without
 * an extra page fetch.
 */
async function extractEpisodes(url) {
  const res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  const html = await res.text();
  const doc  = _parse(html);

  // AnimeKai episode links: <a num="1" token="XXXX" href="/watch/slug?ep=1">
  const epEls = doc.querySelectorAll("a[num][token], a[num][data-token], .ep-item[num]");

  const episodes = [];

  epEls.forEach(el => {
    const num   = parseFloat(el.getAttribute("num") || "0");
    const token = el.getAttribute("token") || el.getAttribute("data-token") || "";
    const epHref= el.getAttribute("href") || "";

    // Build a self-contained href: watch-page URL + token in query string
    const watchPath = epHref.split("?")[0] || url.replace(BASE_URL, "");
    const fullUrl   = watchPath.startsWith("http")
      ? watchPath
      : `${BASE_URL}${watchPath}`;

    if (num && token) {
      episodes.push({
        number: num,
        href  : `${fullUrl}?token=${token}`
      });
    }
  });

  // Sort ascending
  return episodes.sort((a, b) => a.number - b.number);
}

/**
 * STREAM URL
 * Called when the user selects an episode.
 * Must return: a direct HLS (.m3u8) URL string — or null on failure.
 *
 * The href we built above is: https://anikai.to/watch/<slug>?token=<TOKEN>
 */
async function extractStreamUrl(url) {
  const urlObj   = new URL(url);
  const token    = urlObj.searchParams.get("token");

  if (!token) return null;

  try {
    // 1. Encode the token (required _ param)
    const encToken = await _enc(token);

    // 2. Fetch the server list for this episode
    const listRes  = await fetch(
      `${BASE_URL}/ajax/links/list?token=${token}&_=${encodeURIComponent(encToken)}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Referer"          : BASE_URL
        }
      }
    );
    const listData = await listRes.json();
    const servers  = listData.result || listData.servers || listData.links || [];

    if (!Array.isArray(servers) || servers.length === 0) return null;

    // 3. Prefer SUB servers; fall back to first available
    const server = servers.find(s =>
      (s.type || s.name || "").toLowerCase().includes("sub")
    ) || servers[0];

    const lid    = server.lid || server.id || server.linkId;
    if (!lid) return null;

    // 4. Encode the lid and fetch the encrypted source URL
    const encLid   = await _enc(lid);
    const sourceRes= await fetch(
      `${BASE_URL}/ajax/links/source?id=${lid}&_=${encodeURIComponent(encLid)}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Referer"          : BASE_URL
        }
      }
    );
    const sourceData = await sourceRes.json();
    const encIframe  = sourceData.result || sourceData.url || "";

    if (!encIframe) return null;

    // 5. Decode the encrypted iframe/player URL
    const playerUrl = await _dec(encIframe);
    if (!playerUrl) return null;

    // 6. If the decoded URL is already an m3u8, return it directly
    if (playerUrl.includes(".m3u8")) return playerUrl;

    // 7. Otherwise fetch the player page and extract the m3u8 from its source
    const playerRes  = await fetch(playerUrl, {
      headers: { "Referer": BASE_URL }
    });
    const playerHtml = await playerRes.text();

    const m3u8 = _findM3U8(playerHtml);
    if (m3u8) return m3u8;

    // 8. Last resort: the sresJson.streams[0].url pattern some servers use
    const sresMatch = playerHtml.match(/streams\s*[:=]\s*\[[^\]]*{[^}]*url\s*[:=]\s*["'](https?:[^"']+)['"]/);
    if (sresMatch) return sresMatch[1];

    // Return raw player URL for Sora to attempt loading
    return playerUrl;

  } catch (err) {
    // Surface the error in Sora's console
    console.error("[AnimeKai] extractStreamUrl error:", err);
    return null;
  }
}
