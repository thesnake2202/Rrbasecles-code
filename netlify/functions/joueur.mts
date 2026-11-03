// Fiche d'un joueur AFTT : historique des points (graphique d'évolution) et détail des matchs.
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
  return { name, history, days };
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
    return Response.json(
      { licence, url: `${BASE}/tools/fiche.php?licenceID=${licence}`, fetchedAt: new Date().toISOString(), ...data },
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
