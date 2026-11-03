// Fiche d'un joueur AFTT : historique des points (graphique d'évolution) et détail des matchs.
import { rankHistory, saveSnapshots, today } from "../../db/snapshots.js";
import { latestLimits } from "../../db/limits.js";

const BASE = "https://data.aftt.be";

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
const num = (s: string) => Number(s.replace(/[\s  ]/g, "").replace("−", "-").replace(",", ".")) || 0;

const jsArray = (html: string, name: string): unknown[] => {
  const m = html.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\[[^\\]]*\\])`));
  try {
    return m ? JSON.parse(m[1]) : [];
  } catch {
    return [];
  }
};

function parse(html: string) {
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

export default async (req: Request) => {
  const licence = new URL(req.url).searchParams.get("licence") || "";
  if (!/^\d{3,8}$/.test(licence)) {
    return Response.json({ error: "Numéro de licence invalide." }, { status: 400 });
  }
  try {
    const res = await fetch(`${BASE}/tools/fiche.php?licenceID=${licence}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`AFTT ${res.status}`);
    const data = parse(await res.text());
    if (!data.history.length && !data.days.length) throw new Error("Fiche vide");
    // Mémorise la position du jour puis renvoie tout l'historique des positions.
    let ranks: { date: string; position: number; cat: string }[] = [];
    let limits: Awaited<ReturnType<typeof latestLimits>> = { day: "", limits: [] };
    try {
      if (data.position > 0)
        await saveSnapshots([{ licence, position: data.position, points: data.history.at(-1)?.points, cat: data.cat }]);
      ranks = await rankHistory(licence);
      limits = await latestLimits();
      // Pas encore de seuils : lance leur calcul en arrière-plan (disponibles quelques minutes plus tard).
      if (!limits.limits.length)
        await fetch(new URL("/api/seuils-classement", req.url), { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => {});
    } catch (e) {
      console.error(e);
    }
    if (data.position > 0 && !ranks.some((r) => r.date === today()))
      ranks.push({ date: today(), position: data.position, cat: data.cat });
    return Response.json(
      { licence, url: `${BASE}/tools/fiche.php?licenceID=${licence}`, fetchedAt: new Date().toISOString(), ...data, ranks, limits },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400",
          "Netlify-Vary": "query=licence",
        },
      },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Impossible de récupérer la fiche du joueur AFTT." }, { status: 502 });
  }
};

export const config = { path: "/api/joueur" };
