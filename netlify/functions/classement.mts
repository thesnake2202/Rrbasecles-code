// Récupère les classements interclubs AFTT du club H297 et les renvoie en JSON.
const SOURCE = "https://data.aftt.be/interclubs/rankings.php";
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

const cells = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

function parse(html: string) {
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

export default async (req: Request) => {
  const week = Number(new URL(req.url).searchParams.get("semaine"));
  if (!Number.isInteger(week) || week < 1 || week > 22) {
    return Response.json({ error: "Paramètre semaine invalide (1 à 22)." }, { status: 400 });
  }
  try {
    const res = await fetch(SOURCE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ indice: CLUB, semaine: String(week) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`AFTT ${res.status}`);
    const divisions = parse(await res.text());
    if (!divisions.length) throw new Error("Aucune division trouvée");
    return Response.json(
      { week, club: CLUB, fetchedAt: new Date().toISOString(), divisions },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=1800, stale-while-revalidate=86400",
          "Netlify-Vary": "query=semaine",
        },
      },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Impossible de récupérer les classements AFTT." }, { status: 502 });
  }
};

export const config = { path: "/api/classement" };
