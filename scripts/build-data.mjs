// Génère les fichiers du dossier data/ à partir des sites de l'AFTT.
// Remplace les fonctions Netlify (classement, joueurs, joueur, matchs, releve-classement,
// seuils-classement, surveille-actifs) et la base de données.
// Lancé par GitHub Actions (.github/workflows/update-data.yml). Node 20+, aucune dépendance.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CLUB = "H297";
const BASE = "https://data.aftt.be";
const TABT = "https://resultats.aftt.be/api/";
// Adresse de l'ancien site Netlify : sert une seule fois à récupérer l'historique des classements.
const IMPORT_FROM = (process.env.IMPORT_FROM || "").trim().replace(/\/+$/, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Date du jour en Belgique (AAAA-MM-JJ).
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });

let failures = 0;
const fail = (what, e) => {
  failures++;
  console.error(`❌ ${what} : ${e?.message || e}`);
};

/* ---------- Outils ---------- */

const decode = (s) =>
  s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const num = (s) => Number(s.replace(/[\s\u00a0\u202f]/g, "").replace("−", "-").replace(",", ".")) || 0;
const cells = (row) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

// Téléchargement avec quelques nouvelles tentatives.
async function getText(url, init = {}) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
      if (res.ok) return await res.text();
      err = new Error(`HTTP ${res.status} ${url}`);
      if (res.status === 429 || res.status >= 500) await sleep((Number(res.headers.get("retry-after")) || 5 * (i + 1)) * 1000);
      else break;
    } catch (e) {
      err = e;
      await sleep(3000 * (i + 1));
    }
  }
  throw err;
}

const readJson = async (path, dflt) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return dflt;
  }
};

// Écrit le fichier seulement si les données ont changé (hors "fetchedAt") : pas de commit inutile.
async function save(path, data) {
  const strip = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const { fetchedAt, ...rest } = o;
    return rest;
  };
  const old = await readJson(path, null);
  if (old && JSON.stringify(strip(old)) === JSON.stringify(strip(data))) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
  return true;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/* ---------- Classements interclubs (une semaine) ---------- */

function parseClassement(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<form\b[\s\S]*?<\/form>/g, "");
  const parts = html.split(/<div class="card-header[^"]*">/).slice(1);
  return parts
    .map((part) => {
      const title = text(part.slice(0, part.indexOf("</div>")));
      const bodies = [...part.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1]);
      const rows = [...(bodies[0] || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
        .map((m) => cells(m[1]).map(text))
        .filter((c) => c.length >= 8)
        .map(([rank, team, j, g, p, n, ff, pts]) => ({
          rank: Number(rank),
          team,
          played: Number(j),
          won: Number(g),
          lost: Number(p),
          draw: Number(n),
          ff: Number(ff),
          points: Number(pts),
        }));
      const matches = [...(bodies[1] || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
        .map((m) => cells(m[1]).map(text))
        .filter((c) => c.length >= 3)
        .map(([home, score, away]) => ({ home, score, away }));
      return { title, rows, matches };
    })
    .filter((d) => d.title.startsWith("Division") && d.rows.length);
}

/* ---------- Calendrier et résultats (API officielle TabT) ---------- */

const SOAP = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://api.frenoy.net/TabTAPI">
<soap:Body><t:GetMatchesRequest><t:Club>${CLUB}</t:Club><t:ShowDivisionName>yes</t:ShowDivisionName></t:GetMatchesRequest></soap:Body>
</soap:Envelope>`;

function parseMatchs(xml) {
  return [...xml.matchAll(/<ns1:TeamMatchesEntries>([\s\S]*?)<\/ns1:TeamMatchesEntries>/g)].map(([, e]) => {
    e = e.replace(/<ns1:VenueEntry>[\s\S]*?<\/ns1:VenueEntry>/, "");
    const g = (k) => decode((e.match(new RegExp(`<ns1:${k}>([^<]*)</ns1:${k}>`)) || [])[1] || "").trim();
    return {
      division: g("DivisionName"),
      week: Number(g("WeekName")) || 0,
      date: g("Date"),
      time: g("Time").slice(0, 5),
      homeClub: g("HomeClub"),
      home: g("HomeTeam"),
      awayClub: g("AwayClub"),
      away: g("AwayTeam"),
      score: g("Score"),
      homeForfeit: g("IsHomeForfeited") === "true",
      awayForfeit: g("IsAwayForfeited") === "true",
    };
  });
}

/* ---------- Liste des joueurs du club et fiche d'un joueur ---------- */

function parseList(html) {
  // Seulement l'onglet « mixte » : l'onglet « dames » reprend une partie des mêmes joueurs.
  const start = html.indexOf('id="listing-mixed"');
  const end = html.indexOf('id="listing-women"');
  const part = html.slice(Math.max(0, start), end > start ? end : undefined);
  return [...part.matchAll(/<tr data-listing-row[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => {
      const c = [...m[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
      const val = (i) => (c[i]?.[1].match(/data-sort-value="([^"]*)"/) || [])[1] ?? "";
      return {
        licence: (m[1].match(/licenceID=(\d+)/) || [])[1] || "",
        name: decode(val(1)) || text(c[1]?.[2] || ""),
        rank: num(val(0)),
        cat: text(c[2]?.[2] || ""),
        matches: num(val(4)),
        points: num(val(5)),
        evolution: 0,
      };
    })
    .filter((p) => p.licence && p.name);
}

const jsArray = (html, name) => {
  const m = html.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\[[^\\]]*\\])`));
  try {
    return m ? JSON.parse(m[1]) : [];
  } catch {
    return [];
  }
};

function parseFiche(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const labels = jsArray(html, "historyLabels").map(String);
  const points = jsArray(html, "historyPoints").map(Number);
  const history = labels.map((date, i) => ({ date, points: points[i] })).filter((h) => Number.isFinite(h.points));
  const days = html
    .split(/<div class="card day-result-card[^"]*">/)
    .slice(1)
    .map((card) => {
      const header = text((card.match(/<h6[^>]*>([\s\S]*?)<\/h6>/) || [])[1] || "");
      const [date = "", ref = "", ...rest] = header.split(" - ");
      const total = num(((card.match(/day-points-badge[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "").replace(/[^\d+\-−.,]/g, ""));
      const matches = card
        .split(/<div class="match-card-modern[^"]*">/)
        .slice(1)
        .map((m) => ({
          opponent: text((m.match(/class="opponent-link"[^>]*>([\s\S]*?)<\/button>/) || [])[1] || ""),
          ranking: text((m.match(/fa-trophy[^>]*><\/i>([\s\S]*?)<\/small>/) || [])[1] || ""),
          score: text((m.match(/<h5>([\s\S]*?)<\/h5>/) || [])[1] || ""),
          opponentPoints: num(((m.match(/match-score[\s\S]*?<small[^>]*>([\s\S]*?)<\/small>/) || [])[1] || "").replace(/pts/i, "")),
          delta: num(((m.match(/class="match-delta[^"]*">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/pts/i, "")),
          women: /match-category women/.test(m),
        }))
        .filter((m) => m.opponent);
      return { date, ref, club: rest.join(" - "), total, matches };
    })
    .filter((d) => d.date && d.matches.length);
  const name = text((html.match(/<div class="player-identity"[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
  // Position au classement numérique (sans les inactifs), ex. « 4908e ».
  const position = num(
    text((html.match(/<h5[^>]*>\s*Ranking\s*<\/h5>\s*<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || "").split("/")[0].replace(/e\b.*/, ""),
  );
  const cat = text((html.match(/Classement\s+Messieurs[\s\S]{0,200}?letter-ranking[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "");
  return { name, history, days, position, cat };
}

/* ---------- Historique des positions (remplace la base de données) ---------- */
// Format : { "<licence>": { "AAAA-MM-JJ": [position, points, classement] } }

function setSnap(snaps, licence, day, position, points, cat) {
  if (!licence || !Number.isInteger(position) || position <= 0) return;
  const mine = (snaps[licence] = snaps[licence] || {});
  const prev = mine[day] || [];
  mine[day] = [position, points ?? prev[1] ?? null, cat || prev[2] || ""];
}

const ranksOf = (snaps, licence) =>
  Object.entries(snaps[licence] || {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => ({ date, position: v[0], cat: v[2] || "" }));

/* ---------- Paliers des classements lettres (tableau d'équivalence AFTT 2026-2027) ---------- */

const ORDER = ["A", "B0", "B2", "B4", "B6", "C0", "C2", "C4", "C6", "D0", "D2", "D4", "D6", "E0", "E2", "E4", "E6", "NC"];

// Classement lettre normalisé (« A12 » / « As7 » → « A », « B2 / A7 » → « B2 »).
const letter = (s = "") => {
  const t = s.trim().split(/[\s/]+/)[0].toUpperCase();
  return t.startsWith("A") ? "A" : ORDER.includes(t) ? t : "";
};

// Colonne k = tranche de 11 750 + 500·k à 12 249 + 500·k joueurs actifs.
const TABLE = {
  A: Array(17).fill(20),
  B0: Array(17).fill(75),
  B2: [205, 210, 220, 225, 230, 235, 240, 245, 250, 255, 260, 270, 275, 280, 285, 290, 295],
  B4: [405, 420, 435, 450, 460, 475, 490, 505, 520, 530, 545, 560, 575, 585, 600, 615, 630],
  B6: [820, 855, 885, 915, 945, 980, 1010, 1040, 1075, 1105, 1135, 1165, 1200, 1230, 1260, 1290, 1325],
  C0: [1275, 1325, 1375, 1425, 1475, 1525, 1575, 1625, 1675, 1725, 1775, 1825, 1875, 1925, 1975, 2025, 2080],
  C2: [1855, 1930, 2005, 2080, 2155, 2230, 2305, 2380, 2455, 2530, 2605, 2680, 2755, 2830, 2905, 2975, 3050],
  C4: [2575, 2680, 2785, 2890, 2995, 3100, 3205, 3310, 3415, 3520, 3625, 3730, 3835, 3940, 4045, 4150, 4255],
  C6: [3335, 3470, 3610, 3745, 3880, 4020, 4155, 4290, 4430, 4565, 4700, 4840, 4975, 5110, 5250, 5385, 5520],
  D0: [4120, 4285, 4455, 4625, 4795, 4965, 5135, 5305, 5475, 5645, 5815, 5985, 6150, 6320, 6490, 6660, 6830],
  D2: [4925, 5130, 5330, 5535, 5740, 5940, 6145, 6350, 6550, 6755, 6960, 7160, 7365, 7570, 7770, 7975, 8180],
  D4: [5810, 6050, 6295, 6535, 6775, 7015, 7255, 7495, 7735, 7975, 8215, 8460, 8700, 8940, 9180, 9420, 9660],
  D6: [6745, 7025, 7305, 7585, 7865, 8145, 8425, 8705, 8985, 9265, 9545, 9825, 10105, 10385, 10665, 10945, 11220],
  E0: [7720, 8040, 8365, 8685, 9005, 9325, 9645, 9965, 10285, 10605, 10925, 11250, 11570, 11890, 12210, 12530, 12850],
  E2: [8745, 9110, 9470, 9835, 10200, 10560, 10925, 11290, 11650, 12015, 12380, 12740, 13105, 13470, 13835, 14195, 14560],
  E4: [10080, 10500, 10915, 11335, 11755, 12175, 12595, 13015, 13435, 13855, 14275, 14690, 15110, 15530, 15950, 16370, 16790],
  E6: [12000, 12500, 13000, 13500, 14000, 14500, 15000, 15500, 16000, 16500, 17000, 17500, 18000, 18500, 19000, 19500, 20000],
};

const column = (actives) => Math.min(16, Math.max(0, Math.floor((actives - 11750) / 500)));

// Page « Outils » de l'AFTT : nombre officiel de joueurs actifs (hors NC) et date du dernier calcul.
async function fetchActives() {
  const html = await getText(`${BASE}/tools/index.php?lang=en`);
  const m = html.match(/ranking-stat-value">([^<]*)<\/div>\s*<p class="ranking-stat-label">\s*joueurs actifs/i);
  const actives = Number((m?.[1] || "").replace(/\D/g, ""));
  if (!actives) throw new Error("Nombre de joueurs actifs introuvable sur la page Outils AFTT");
  const calc = ((html.match(/Dernier calcul mixte termin[^:]*:\s*([^<]*)/) || [])[1] || "").trim();
  return { actives, calc };
}

async function rankingPage(n) {
  const html = await getText(`${BASE}/ranking/tops.php?q=&page=${n}&view=mixed`);
  const pages = Number((html.match(/Page\s+\d+\s*\/\s*(\d+)/) || [])[1]) || 0;
  const start = html.indexOf('data-ranking-table="mixte"');
  if (start < 0) throw new Error("Tableau introuvable");
  const part = html.slice(start, html.indexOf("</table>", start));
  const rows = [...part.matchAll(/<tr class="ranking-row"[\s\S]*?<\/tr>/g)].map((m) => ({
    position: Number(((m[0].match(/rank-pill[^"]*">([^<]*)/) || [])[1] || "").replace(/\D/g, "")) || 0,
    cat: letter((m[0].match(/ranking-badge">([^<]*)/) || [])[1] || ""),
    points: Number(((m[0].match(/points-cell">([^<]*)/) || [])[1] || "").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
  }));
  return { rows, pages };
}

// Parcourt tout le classement mixte pour relever les points à chaque palier (même calcul qu'avant).
async function computeLimits() {
  const official = await fetchActives().catch((e) => (console.error(e), null));
  const first = await rankingPage(1);
  if (!first.pages || !first.rows.length) throw new Error("Classement AFTT vide");
  const all = [first.rows];
  // Une page à la fois, avec une courte pause, pour ménager le site de l'AFTT.
  for (let n = 2; n <= first.pages; n++) {
    await sleep(1500);
    all.push((await rankingPage(n)).rows);
  }
  const rows = all
    .flat()
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position);

  const actives = official?.actives || rows.filter((r) => r.cat && r.cat !== "NC").length;
  const afttCalc = official?.calc || "";
  const k = column(actives);

  // La place d'un actif = son rang AFTT moins le nombre de NC classés devant lui.
  const act = [];
  let nc = 0;
  for (const r of rows) {
    if (!r.cat || r.cat === "NC") {
      if (r.cat === "NC") nc++;
      continue;
    }
    act.push({ ...r, place: r.position - nc });
  }
  const lastRank = rows[rows.length - 1].position;
  const lastPlace = act.length ? act[act.length - 1].place : 0;
  const limits = Object.entries(TABLE).map(([cat, cols], i, arr) => {
    const place = cols[k];
    const prev = i ? arr[i - 1][1][k] : 0;
    // Dernier actif à l'intérieur du palier (aucun si le palier couvre tous les actifs).
    const at = place <= lastPlace ? act.filter((r) => r.place <= place).at(-1) : undefined;
    return { cat, players: place - prev, lastPosition: at ? at.position : lastRank, points: at ? at.points : null };
  });
  return { day: today(), actives, afttCalc, limits };
}

/* ---------- Adaptation de index.html (appels /api/... → fichiers data/...) ---------- */

async function patchIndex() {
  let html;
  try {
    html = await readFile("index.html", "utf8");
  } catch {
    return;
  }
  const swaps = [
    ['"/api/joueurs"', '"data/joueurs.json"'],
    ['"/api/matchs"', '"data/matchs.json"'],
    ['"/api/classement?semaine="+w', '"data/classement/"+w+".json"'],
    ['"/api/joueur?licence="+encodeURIComponent(l)', '"data/joueur/"+encodeURIComponent(l)+".json"'],
  ];
  let out = html;
  for (const [a, b] of swaps) out = out.split(a).join(b);
  if (out !== html) {
    await writeFile("index.html", out);
    console.log("index.html adapté : il lit maintenant les fichiers du dossier data/.");
  }
}

/* ---------- Programme principal ---------- */

async function main() {
  const day = today();
  await mkdir("data", { recursive: true });
  await patchIndex();

  // 1. Calendrier et résultats des matchs
  try {
    const xml = await getText(TABT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "GetMatches" },
      body: SOAP,
    });
    const matches = parseMatchs(xml);
    if (!matches.length) throw new Error("Aucun match trouvé");
    await save("data/matchs.json", { club: CLUB, fetchedAt: new Date().toISOString(), matches });
    console.log(`✔ matchs : ${matches.length}`);
  } catch (e) {
    fail("matchs", e);
  }

  // 2. Classements des 22 semaines
  for (let week = 1; week <= 22; week++) {
    try {
      const html = await getText(`${BASE}/interclubs/rankings.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ indice: CLUB, semaine: String(week) }),
      });
      const divisions = parseClassement(html);
      if (!divisions.length) {
        console.log(`– semaine ${week} : pas encore de données`);
      } else {
        await save(`data/classement/${week}.json`, { week, club: CLUB, fetchedAt: new Date().toISOString(), divisions });
      }
    } catch (e) {
      fail(`classement semaine ${week}`, e);
    }
    await sleep(300);
  }
  console.log("✔ classements des semaines");

  // 3. Paliers des classements lettres (recalculés une fois par jour ou si l'AFTT change son nombre d'actifs)
  let lim = await readJson("data/limits.json", { day: "", actives: 0, afttCalc: "", limits: [] });
  try {
    const now = await fetchActives().catch((e) => (console.error(e), null));
    const need = !lim.limits.length || lim.day !== day || (now && (now.actives !== lim.actives || now.calc !== lim.afttCalc));
    if (need) {
      lim = await computeLimits();
      await save("data/limits.json", lim);
      console.log(`✔ paliers recalculés (${lim.actives} actifs)`);
    } else {
      console.log("✔ paliers déjà à jour");
    }
  } catch (e) {
    fail("paliers", e);
  }

  // 4. Joueurs du club, fiches et historique des positions
  try {
    const players = parseList(await getText(`${BASE}/ranking/clubs.php?indice=${CLUB}`));
    if (!players.length) throw new Error("Aucun joueur trouvé");
    const snaps = await readJson("data/snapshots.json", {});

    // Import unique de l'historique depuis l'ancien site Netlify (complète seulement les jours manquants).
    if (IMPORT_FROM) {
      let n = 0;
      for (const p of players) {
        try {
          const res = await fetch(`${IMPORT_FROM}/api/joueur?licence=${encodeURIComponent(p.licence)}`, { signal: AbortSignal.timeout(30000) });
          const j = await res.json();
          for (const r of j.ranks || []) {
            const mine = (snaps[p.licence] = snaps[p.licence] || {});
            if (r.date && r.position > 0 && !mine[r.date]) {
              mine[r.date] = [r.position, null, r.cat || ""];
              n++;
            }
          }
        } catch (e) {
          fail(`import ${p.licence}`, e);
        }
        await sleep(500);
      }
      console.log(`✔ historique importé : ${n} relevé(s)`);
    }

    // Position du jour de chaque joueur.
    for (const p of players) setSnap(snaps, p.licence, day, p.rank, p.points, p.cat);

    await pool(players, 4, async (p) => {
      try {
        const html = await getText(`${BASE}/tools/fiche.php?licenceID=${p.licence}`);
        const evo = text(html).match(/([+\-−]?\s*\d[\d\s.,]*)\s*depuis les points de base/);
        p.evolution = evo ? num(evo[1]) : 0;
        const d = parseFiche(html);
        if (!d.history.length && !d.days.length) throw new Error("Fiche vide");
        if (d.position > 0) setSnap(snaps, p.licence, day, d.position, d.history.at(-1)?.points, d.cat);
        await save(`data/joueur/${p.licence}.json`, {
          licence: p.licence,
          url: `${BASE}/tools/fiche.php?licenceID=${p.licence}`,
          fetchedAt: new Date().toISOString(),
          ...d,
          ranks: ranksOf(snaps, p.licence),
          limits: lim,
        });
      } catch (e) {
        fail(`fiche ${p.licence}`, e);
      }
    });

    await save("data/joueurs.json", { club: CLUB, fetchedAt: new Date().toISOString(), players });
    await save("data/snapshots.json", snaps);
    console.log(`✔ joueurs : ${players.length}`);
  } catch (e) {
    fail("joueurs", e);
  }

  console.log(failures ? `Terminé avec ${failures} erreur(s).` : "Terminé sans erreur.");
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
