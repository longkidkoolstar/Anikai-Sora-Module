// =============================================
// AnimeKai (anikai.to) — Sora/Sulfur Module
// Author : longkidkoolstar
// Version: 1.1.0
// Compat : No optional chaining, no DOMParser
// =============================================

var BASE_URL = "https://anikai.to";
var ENC_API  = "https://enc-dec.app/api";

// ── Helpers ──────────────────────────────────

async function _enc(text) {
  var res  = await fetch(ENC_API + "/enc-movies-flix?text=" + encodeURIComponent(text));
  var data = await res.json();
  return data.result;
}

async function _dec(text) {
  var res  = await fetch(ENC_API + "/dec-movies-flix?text=" + encodeURIComponent(text));
  var data = await res.json();
  return data.result;
}

function _matchAll(str, regex) {
  var matches = [];
  var m;
  var r = new RegExp(regex.source, regex.flags.replace("g", "") + "g");
  while ((m = r.exec(str)) !== null) {
    matches.push(m);
  }
  return matches;
}

function _findM3U8(html) {
  var patterns = [
    /["'`](https?:\/\/[^"'`\s]*\.m3u8[^"'`\s]*)[`"']/,
    /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/,
    /src\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/,
    /sources[^[]*\[[^\]]*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

// ── Sora interface functions ──────────────────

async function searchResults(query) {
  var url  = BASE_URL + "/browser?keyword=" + encodeURIComponent(query);
  var res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  var html = await res.text();

  var results = [];
  var cardPattern = /<div[^>]+class="[^"]*(?:flw-item|aitem|item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  var m;

  while ((m = cardPattern.exec(html)) !== null) {
    var block = m[0];

    var hrefM = block.match(/href="(\/watch\/[^"]+)"/);
    if (!hrefM) continue;
    var href = BASE_URL + hrefM[1].split("?")[0];

    var titleM = block.match(/data-jname="([^"]+)"/);
    if (!titleM) titleM = block.match(/title="([^"]+)"/);
    if (!titleM) titleM = block.match(/class="[^"]*(?:film-name|name|title)[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);
    if (!titleM) continue;
    var title = titleM[1].trim();

    var imgM = block.match(/data-src="([^"]+)"/);
    if (!imgM) imgM = block.match(/<img[^>]+src="([^"]+)"/);
    var image = imgM ? imgM[1] : "";
    if (image && !image.match(/^https?:\/\//)) image = BASE_URL + image;

    results.push({ title: title, image: image, href: href });
  }

  return results;
}

async function extractDetails(url) {
  var res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  var html = await res.text();

  var descM = html.match(/class="[^"]*(?:film-description|description|synopsis)[^"]*"[^>]*>[\s\S]*?<[^>]+class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!descM) descM = html.match(/class="[^"]*(?:description|synopsis)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
  var description = "";
  if (descM) {
    description = descM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  var genreMatches = _matchAll(html, /class="[^"]*genre[^"]*"[^>]*><a[^>]*>([^<]+)<\/a>/);
  var genres = genreMatches.map(function(gm) { return gm[1].trim(); }).join(", ");

  var airM = html.match(/(?:Premiered|Aired)[^:]*:\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/i);
  if (!airM) airM = html.match(/(?:Premiered|Aired)[^<]*<\/[^>]+>\s*([A-Z][a-z]+ \d{4})/i);
  var airdate = airM ? airM[1].trim() : "";

  return [{ description: description, aliases: genres, airdate: airdate }];
}

async function extractEpisodes(url) {
  var res  = await fetch(url, { headers: { "Referer": BASE_URL } });
  var html = await res.text();
  var episodes = [];

  var epPattern = /<a[^>]+num="(\d+(?:\.\d+)?)"[^>]+(?:data-)?token="([^"]+)"[^>]+href="([^"]+)"[^>]*>/g;
  var m;
  while ((m = epPattern.exec(html)) !== null) {
    var num    = parseFloat(m[1]);
    var token  = m[2];
    var epHref = m[3].split("?")[0];
    var full   = epHref.match(/^https?:\/\//) ? epHref : BASE_URL + epHref;
    episodes.push({ number: num, href: full + "?token=" + token });
  }

  var epPattern2 = /<a[^>]+(?:data-)?token="([^"]+)"[^>]+num="(\d+(?:\.\d+)?)"[^>]+href="([^"]+)"[^>]*>/g;
  while ((m = epPattern2.exec(html)) !== null) {
    var token2 = m[1];
    var num2   = parseFloat(m[2]);
    var href2  = m[3].split("?")[0];
    var found  = false;
    for (var k = 0; k < episodes.length; k++) {
      if (episodes[k].number === num2) { found = true; break; }
    }
    if (!found) {
      var full2 = href2.match(/^https?:\/\//) ? href2 : BASE_URL + href2;
      episodes.push({ number: num2, href: full2 + "?token=" + token2 });
    }
  }

  episodes.sort(function(a, b) { return a.number - b.number; });
  return episodes;
}

async function extractStreamUrl(url) {
  var tokenM = url.match(/[?&]token=([^&]+)/);
  if (!tokenM) return null;
  var token = decodeURIComponent(tokenM[1]);

  try {
    var encToken = await _enc(token);

    var listRes = await fetch(
      BASE_URL + "/ajax/links/list?token=" + token + "&_=" + encodeURIComponent(encToken),
      { headers: { "X-Requested-With": "XMLHttpRequest", "Referer": BASE_URL } }
    );
    var listData = await listRes.json();
    var servers  = listData.result || listData.servers || listData.links || [];

    if (!servers || servers.length === 0) return null;

    var server = null;
    for (var i = 0; i < servers.length; i++) {
      var sname = (servers[i].type || servers[i].name || servers[i].title || "").toLowerCase();
      if (sname.indexOf("sub") !== -1) { server = servers[i]; break; }
    }
    if (!server) server = servers[0];

    var lid = server.lid || server.id || server.linkId || server.link_id;
    if (!lid) return null;

    var encLid = await _enc(String(lid));
    var sourceRes = await fetch(
      BASE_URL + "/ajax/links/source?id=" + lid + "&_=" + encodeURIComponent(encLid),
      { headers: { "X-Requested-With": "XMLHttpRequest", "Referer": BASE_URL } }
    );
    var sourceData = await sourceRes.json();
    var encIframe  = sourceData.result || sourceData.url || sourceData.link || "";
    if (!encIframe) return null;

    var playerUrl = await _dec(encIframe);
    if (!playerUrl) return null;

    if (playerUrl.indexOf(".m3u8") !== -1) return playerUrl;

    var playerRes  = await fetch(playerUrl, { headers: { "Referer": BASE_URL } });
    var playerHtml = await playerRes.text();

    var m3u8 = _findM3U8(playerHtml);
    if (m3u8) return m3u8;

    var sresM = playerHtml.match(/streams\s*[=:]\s*\[[^\]]*url\s*[=:]\s*["'](https?:[^"']+)['"]/);
    if (sresM) return sresM[1];

    return playerUrl;

  } catch (err) {
    console.error("[AnimeKai] error: " + err.message);
    return null;
  }
}
