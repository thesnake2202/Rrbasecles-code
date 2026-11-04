// Récupère le calendrier et les résultats interclubs du club H297 via l'API officielle de l'AFTT (TabT).
// AFTT DATA n'affiche pas les dates/heures des matchs à venir : cette API est la source dont il dépend.
const API = "https://resultats.aftt.be/api/";
const CLUB = "H297";

const BODY = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://api.frenoy.net/TabTAPI">
<soap:Body><t:GetMatchesRequest><t:Club>${CLUB}</t:Club><t:ShowDivisionName>yes</t:ShowDivisionName></t:GetMatchesRequest></soap:Body>
</soap:Envelope>`;

const decode = (s: string) =>
  s
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function parse(xml: string) {
  return [...xml.matchAll(/<ns1:TeamMatchesEntries>([\s\S]*?)<\/ns1:TeamMatchesEntries>/g)].map(([, e]) => {
    e = e.replace(/<ns1:VenueEntry>[\s\S]*?<\/ns1:VenueEntry>/, "");
    const g = (k: string) => decode((e.match(new RegExp(`<ns1:${k}>([^<]*)</ns1:${k}>`)) || [])[1] || "").trim();
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

export default async () => {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "GetMatches" },
      body: BODY,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`AFTT ${res.status}`);
    const matches = parse(await res.text());
    if (!matches.length) throw new Error("Aucun match trouvé");
    return Response.json(
      { club: CLUB, fetchedAt: new Date().toISOString(), matches },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=900, stale-while-revalidate=86400",
        },
      },
    );
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Impossible de récupérer les matchs AFTT." }, { status: 502 });
  }
};

export const config = { path: "/api/matchs" };
