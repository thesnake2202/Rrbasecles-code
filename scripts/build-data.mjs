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
          op
