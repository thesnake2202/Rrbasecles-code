// Relevé quotidien automatique de la position de chaque joueur du club au classement numérique AFTT.
import type { Config } from "@netlify/functions";
import { saveSnapshots } from "../../db/snapshots.js";

const BASE = "https://data.aftt.be";
const CLUB = "H297";

export default async () => {
  const res = await fetch(`${BASE}/ranking/clubs.php?indice=${CLUB}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`AFTT ${res.status}`);
  const html = await res.text();
  const start = html.indexOf('id="listing-mixed"');
  const end = html.indexOf('id="listing-women"');
  const part = html.slice(Math.max(0, start), end > start ? end : undefined);
  const rows = [...part.matchAll(/<tr data-listing-row[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
    const vals = [...m[1].matchAll(/<td\b[^>]*data-sort-value="([^"]*)"/g)].map((v) => v[1]);
    return {
      licence: (m[1].match(/licenceID=(\d+)/) || [])[1] || "",
      position: Number(vals[0]) || 0,
      cat: vals[2] || "",
      points: Number(vals[5]) || undefined,
    };
  });
  const n = await saveSnapshots(rows);
  console.log(`Relevé du classement : ${n} joueur(s) enregistré(s).`);
  // Recalcule en arrière-plan les seuils estimés des classements lettres.
  const site = Netlify.env.get("URL");
  if (site) await fetch(`${site}/api/seuils-classement`, { method: "POST" }).catch((e) => console.error(e));
};

// Tous les jours à 6h UTC.
export const config: Config = { schedule: "0 6 * * *" };
