// Récupère le classement numérique des joueurs du club H297 depuis AFTT DATA.
import { saveSnapshots } from "../../db/snapshots.js";

const BASE = "https://data.aftt.be";
const CLUB = "H297";

const decode = (s: string) =>
  s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

const text = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const num = (s: string) => Number(s.replace(/[\s  ]/g, "").replace("−", "-").replace(",", ".")) || 0;

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`AFTT ${res.status} ${url}`);
  return res.text();
};

function parseList(html: string) {
  // Seulement l'onglet « mixte » : l'onglet « dames » reprend une partie des mêmes joueurs.
  const start = html.indexOf('id="listing-mixed"');
  const end = html.indexOf('id="listing-women"');
  const part = html.slice(Math.max(0, start), end > start ? end : undefined);
  return [...part.matchAll(/<tr data-listing-row[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => {
      const c = [...m[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
      const val = (i: number) => (c[i]?.[1].match(/data-sort-value="([^"]*)"/) || [])[1] ?? "";
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

// Évolution depuis le début de saison, lue sur la fiche du joueur.
async function evolution(licence: string) {
  const m = text(await get(`${BASE}/tools/fiche.php?licenceID=${licence}`)).match(
    /([+\-−]?\s*\d[\d\s.,]*)\s*depuis les points de base/,
  );
  return m ? num(m[1]) : 0;
}

export default async () => {
  try {
    const players = parseList(await get(`${BASE}/ranking/clubs.php?indice=${CLUB}`));
    if (!players.length) throw new Error("Aucun joueur trouvé");
    // Mémorise la position du jour de chaque joueur (historique du classement).
    await saveSnapshots(players.map((p) => ({ licence: p.licence, position: p.rank, points: p.points, cat: p.cat }))).catch(
      (e) => console.error(e),
    );
    let i = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (i < players.length) {
          const p = players[i++];
          try {
            p.evolution = await evolution(p.licence);
          } catch (e) {
            console.error(e);
          }
        }
      }),
    );
    return Response.json(
      { club: CLUB, fetchedAt: new Date().toISOString(), players },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Impossible de récupérer le classement des joueurs AFTT." }, { status: 502 });
  }
};

export const config = { path: "/api/joueurs" };
