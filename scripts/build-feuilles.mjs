import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CLUB = "H297";
const BASE = "https://data.aftt.be";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (what, e) => {
  failures++;
  console.error(`❌ ${what} : ${e?.message || e}`);
};
const decode = (s) =>
  s.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const cells = (row) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

async function post(url, fields) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) return await res.text();
      err = new Error(`HTTP ${res.status}`);
    } catch (e) {
      err = e;
    }
    await sleep(3000 * (i + 1));
  }
  throw err;
}
const readJson = async (p, d) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return d;
  }
};
async function save(p, data) {
  const s = JSON.stringify(data);
  try {
    if ((await readFile(p, "utf8")) === s) return;
  } catch {}
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, s);
}

// Rencontres d'une page « classement » : identifiant du petit œil + équipes + score.
function parseIds(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  for (const part of html.split(/<div class="card-header[^"]*">/).slice(1)) {
    const title = text(part.slice(0, part.indexOf("</div>")));
    if (!title.startsWith("Division")) continue;
    const bodies = [...part.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1]);
    for (const m of (bodies[1] || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      const id = (m[1].match(/name="match_id"\s+value="(\d+)"/) || [])[1];
      const c = cells(m[1].replace(/<form\b[\s\S]*?<\/form>/g, "")).map(text);
      if (id && c.length >= 3) out.push({ id, title, home: c[0], score: c[1], away: c[2] });
    }
  }
  return out;
}

// Page « match.php » : joueurs de chaque équipe + détail des parties.
function parseFeuille(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const pick = (re) => text((html.match(re) || [])[1] || "");
  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) =>
    [...m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => cells(r[1]).map(text)).filter((c) => c.length),
  );
  const players = (t = []) =>
    t.filter((c) => c.length >= 4).map(([n, name, cat, wins]) => ({ n: Number(n), name, cat, wins: Number(wins) || 0 }));
  const who = (s) => {
    const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? [m[1], m[2]] : [s, ""];
  };
  const rows = (tables[2] || [])
    .filter((c) => c.length >= 6)
    .map(([n, h, s, a, sets, c]) => {
      const [hn, hc] = who(h);
      const [an, ac] = who(a);
      return { n: Number(n), h: hn, hc, a: an, ac, s: s.replace(/[—–]/g, "–"), sets: sets === "/" ? "" : sets, c };
    });
  return {
    home: pick(/class="match-team home">[\s\S]*?<strong>([\s\S]*?)<\/strong>/),
    away: pick(/class="match-team away">[\s\S]*?<strong>([\s\S]*?)<\/strong>/),
    score: pick(/class="match-score">[\s\S]*?<strong>([\s\S]*?)<\/strong>/),
    date: (html.match(/fa-calendar-day"><\/i>\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || "",
    time: (html.match(/fa-clock[^"]*"><\/i>\s*(\d{2}:\d{2})/) || [])[1] || "",
    hp: players(tables[0]),
    ap: players(tables[1]),
    rows,
  };
}

const ours = new Map();
for (let week = 1; week <= 22; week++) {
  try {
    const html = await post(`${BASE}/interclubs/rankings.php`, { indice: CLUB, semaine: String(week) });
    for (const r of parseIds(html)) {
      if (/Bas[eè]cles/i.test(r.home + " " + r.away) && /\d+\s*-\s*\d+/.test(r.score) && !/^0\s*-\s*0$/.test(r.score)) {
        ours.set(r.id, { ...r, week });
      }
    }
  } catch (e) {
    fail(`semaine ${week}`, e);
  }
  await sleep(300);
}

const index = await readJson("data/feuilles/index.json", {});
const maxWeek = Math.max(0, ...[...ours.values()].map((o) => o.week));
for (const o of ours.values()) {
  // Les anciennes feuilles déjà enregistrées ne sont pas relues.
  if (index[o.id] && index[o.id].score === o.score && o.week < maxWeek - 1) continue;
  try {
    const f = parseFeuille(await post(`${BASE}/interclubs/match.php`, { match_id: o.id }));
    if (!f.rows.length) throw new Error("feuille vide");
    await save(`data/feuilles/${o.id}.json`, { id: o.id, ...f });
    index[o.id] = { id: o.id, week: o.week, home: f.home, away: f.away, score: o.score, date: f.date, division: o.title };
    console.log(`✔ feuille ${o.id} : ${f.home} ${f.score} ${f.away}`);
  } catch (e) {
    fail(`feuille ${o.id}`, e);
  }
  await sleep(400);
}
await save("data/feuilles/index.json", index);
console.log(failures ? `Terminé avec ${failures} erreur(s).` : "Terminé sans erreur.");
