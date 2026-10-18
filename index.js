const express = require("express");
const path = require("path");
const https = require("https");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");

// ==========================================
// 1. LOGIKA BYPASS (RESOLVER)
// ==========================================
const UA = "Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";

function createJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    save: (headers) => {
      let cookies = headers["set-cookie"];
      if (!cookies) return;
      if (!Array.isArray(cookies)) cookies = [cookies];
      for (const c of cookies) {
        const first = c.split(";")[0];
        const i = first.indexOf("=");
        if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
      }
    }
  };
}

function decompress(buffer, encoding) {
  return new Promise((resolve, reject) => {
    encoding = String(encoding || "").toLowerCase();
    if (encoding.includes("br")) return zlib.brotliDecompress(buffer, (e, d) => e ? reject(e) : resolve(d));
    if (encoding.includes("gzip")) return zlib.gunzip(buffer, (e, d) => e ? reject(e) : resolve(d));
    if (encoding.includes("deflate")) return zlib.inflate(buffer, (e, d) => e ? reject(e) : resolve(d));
    resolve(buffer);
  });
}

function request(url, options = {}, jar) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const headers = {
      "User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive", ...(options.headers || {})
    };
    const cookies = jar ? jar.header() : "";
    if (cookies) headers.Cookie = cookies;
    const req = transport.request({
      hostname: parsed.hostname, port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET", headers
    }, response => {
      if (jar) jar.save(response.headers);
      const chunks = [];
      response.on("data", c => chunks.push(c));
      response.on("end", async () => {
        try {
          const raw = Buffer.concat(chunks);
          const body = await decompress(raw, response.headers["content-encoding"]);
          resolve({ status: response.statusCode, headers: response.headers, text: body.toString("utf8"), url });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function get(url, options = {}, jar) { return request(url, { ...options, method: "GET" }, jar); }
function postJson(url, data, options = {}, jar) {
  return request(url, {
    ...options, method: "POST", body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json", "Accept": "application/json, */*",
      "Origin": "https://app.khaddavi.net", ...(options.headers || {})
    }
  }, jar);
}

function abs(base, value) { try { return new URL(value, base).href; } catch { return null; } }
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', "i"));
  return m ? m[1] : null;
}

function extractRedirect(html) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  for (const form of forms) {
    const tag = form.match(/<form\b[^>]*>/i);
    if (!tag) continue;
    const action = attr(tag[0], "action");
    if (!action) continue;
    if (!/redirect\.php/i.test(action) && !/ray_id/i.test(form)) continue;
    const actionUrl = abs("https://app.khaddavi.net/", action);
    if (!actionUrl) continue;
    const url = new URL(actionUrl);
    const inputs = form.match(/<input\b[^>]*>/gi) || [];
    for (const input of inputs) {
      const name = attr(input, "name");
      const value = attr(input, "value");
      if (name) url.searchParams.set(name, value || "");
    }
    return url.href;
  }
  return null;
}

function extractScripts(html, base) {
  const scripts = [];
  const regex = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = regex.exec(html))) {
    const url = abs(base, m[1]);
    if (url && !scripts.includes(url)) scripts.push(url);
  }
  return scripts;
}

async function findApiBundle(html, articleUrl, jar) {
  const scripts = extractScripts(html, articleUrl);
  for (const url of scripts) {
    try {
      const r = await get(url, {}, jar);
      if (r.status === 200 && r.text.includes("/api/go")) return r.text;
    } catch {}
  }
  return null;
}

function fallbackFingerprint(articleUrl) {
  return crypto.createHash("sha256").update([UA, articleUrl, "Android", "mobile", "412x915"].join("|")).digest("hex");
}
function makeToken(xsrf, fingerprint) {
  const encoded = "#" + Buffer.from(fingerprint).toString("base64");
  return xsrf.slice(0, Math.max(0, 128 - encoded.length)) + encoded;
}
function makeGoPayload() {
  const key = Math.floor(Math.random() * 1000);
  const width = 412, height = 915;
  return { key, size: (width + key) * 2 + "." + (height + key) * 2, ado: null };
}

async function resolveReadyGo(url, jar) {
  let current = url;
  for (let i = 0; i < 10; i++) {
    const r = await get(current, { headers: { Referer: "https://app.khaddavi.net/", Accept: "text/html,application/xhtml+xml,application/json,*/*" } }, jar);
    const html = r.text || "";
    const location = r.headers.location;
    if (location) {
      const next = abs(current, location);
      if (next && /mediafire\.com\//i.test(next)) return next;
      if (next && next !== current) { current = next; continue; }
    }
    const direct = html.match(/https?:\/\/(?:www\.)?mediafire\.com\/[^\s"'<>\\]+/ig);
    if (direct) {
      for (const raw of direct) {
        const clean = raw.replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/["'<>].*$/, "");
        if (/mediafire\.com\//i.test(clean)) return clean;
      }
    }
    const meta = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*["'][^"']+["'][^>]*>/i);
    if (meta) {
      const m = meta[0].match(/url\s*=\s*([^"'>\s]+)/i);
      if (m) {
        const next = abs(current, m[1]);
        if (next && /mediafire\.com\//i.test(next)) return next;
        if (next && next !== current) { current = next; continue; }
      }
    }
    const canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["']/i);
    if (canonical) {
      const next = abs(current, canonical[1]);
      if (next && /mediafire\.com\//i.test(next)) return next;
    }
    const patterns = [
      /location(?:\.href)?\s*=\s*["']([^"']+)["']/ig,
      /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/ig,
      /document\.location(?:\.href)?\s*=\s*["']([^"']+)["']/ig,
      /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/ig,
      /location\.assign\s*\(\s*["']([^"']+)["']\s*\)/ig
    ];
    for (const regex of patterns) {
      let m;
      while ((m = regex.exec(html))) {
        const value = m[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        const next = abs(current, value);
        if (next && /mediafire\.com\//i.test(next)) return next;
      }
    }
    break;
  }
  return null;
}

async function bypass(input) {
  const jar = createJar();
  const short = await get(input, {}, jar);
  if (short.status !== 200) throw new Error("Shortlink gagal diakses");
  const redirect = extractRedirect(short.text);
  if (!redirect) throw new Error("redirect.php tidak ditemukan di halaman shortlink");
  const red = await get(redirect, {}, jar);
  const articleUrl = red.headers.location || red.url;
  const article = await get(articleUrl, {}, jar);
  await findApiBundle(article.text, articleUrl, jar);
  const xsrfMatch = article.text.match(/name=["']xsrf["']\s+value=["']([^"']+)["']/i)
    || article.text.match(/xsrf["']?\s*[:=]\s*["']([^"']+)["']/i);
  const xsrf = xsrfMatch ? xsrfMatch[1] : crypto.randomBytes(32).toString("hex");
  const fingerprint = fallbackFingerprint(articleUrl);
  const token = makeToken(xsrf, fingerprint);
  const payload = makeGoPayload();
  const apiBase = new URL(articleUrl).origin;
  const goRes = await postJson(apiBase + "/api/go", { ...payload, token, xsrf }, {
    headers: { Referer: articleUrl, "X-Requested-With": "XMLHttpRequest" }
  }, jar);
  let nextUrl = null;
  try {
    const json = JSON.parse(goRes.text);
    nextUrl = json.url || json.redirect || json.location || json.data?.url || null;
  } catch {
    const m = goRes.text.match(/https?:\/\/[^\s"'<>\\]+/i);
    if (m) nextUrl = m[0];
  }
  if (!nextUrl && goRes.headers.location) nextUrl = abs(apiBase, goRes.headers.location);
  if (!nextUrl) throw new Error("Gagal mendapatkan URL dari /api/go");
  const mediafire = await resolveReadyGo(abs(articleUrl, nextUrl), jar);
  if (!mediafire) throw new Error("Gagal resolve ke MediaFire");
  return mediafire;
}

// ==========================================
// 2. SETUP EXPRESS & ROUTING
// ==========================================
const app = express();

// 🔥 FIX: Pake __dirname biar Vercel dijamin nemu folder public
app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

app.post("/api/bypass", async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, error: "URL tidak valid, bro 😅" });
  }
  try {
    const result = await bypass(url.trim());
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Gagal resolve" });
  }
});

// Vercel wajib pake module.exports, jangan app.listen()
module.exports = app;
