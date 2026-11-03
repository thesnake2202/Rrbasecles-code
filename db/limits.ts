// Seuils estimés des classements lettres (A, B0 … NC) à partir du classement numérique mixte AFTT.
// Principe : il y a autant de places pour un classement que de joueurs actifs qui le détiennent
// actuellement. En prenant les joueurs dans l'ordre du classement numérique, les N premiers
// correspondent à « A », les suivants à « B0 », etc. La position d'un joueur indique ainsi le
// classement vers lequel il se dirige.
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./index.js";
import { classLimits } from "./schema.js";
import { today } from "./snapshots.js";

const BASE = "https://data.aftt.be";
export const ORDER = ["A", "B0", "B2", "B4", "B6", "C0", "C2", "C4", "C6", "D0", "D2", "D4", "D6", "E0", "E2", "E4", "E6", "NC"];

// Classement lettre normalisé (« A12 » / « As7 » → « A », « B2 / A7 » → « B2 »).
export const letter = (s = "") => {
  const t = s.trim().split(/[\s/]+/)[0].toUpperCase();
  return t.startsWith("A") ? "A" : ORDER.includes(t) ? t : "";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { position: number; cat: string };

async function page(n: number): Promise<{ rows: Row[]; pages: number }> {
  let err: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${BASE}/ranking/tops.php?q=&page=${n}&view=mixed`, { signal: AbortSignal.timeout(20000) });
      if (res.status == 429 || res.status >= 500) {
        // Trop de requêtes : on patiente avant de réessayer.
        await sleep((Number(res.headers.get("retry-after")) || 5 * (i + 1)) * 1000);
        throw new Error(`AFTT ${res.status}`);
      }
      if (!res.ok) throw new Error(`AFTT ${res.status}`);
      const html = await res.text();
      const pages = Number((html.match(/Page\s+\d+\s*\/\s*(\d+)/) || [])[1]) || 0;
      const start = html.indexOf('data-ranking-table="mixte"');
      if (start < 0) throw new Error("Tableau introuvable");
      const part = html.slice(start, html.indexOf("</table>", start));
      const rows = [...part.matchAll(/<tr class="ranking-row"[\s\S]*?<\/tr>/g)].map((m) => ({
        position: Number(((m[0].match(/rank-pill">([^<]*)/) || [])[1] || "").replace(/\D/g, "")) || 0,
        cat: letter((m[0].match(/ranking-badge">([^<]*)/) || [])[1] || ""),
      }));
      return { rows, pages };
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// Parcourt tout le classement mixte et calcule la dernière position de chaque classement lettre.
export async function computeLimits() {
  const first = await page(1);
  if (!first.pages || !first.rows.length) throw new Error("Classement AFTT vide");
  const all: Row[][] = [first.rows];
  // Une page à la fois, avec une courte pause, pour ménager le site de l'AFTT.
  for (let n = 2; n <= first.pages; n++) {
    await sleep(400);
    all.push((await page(n)).rows);
  }
  const rows = all.flat().filter((r) => r.position > 0 && r.cat);
  const positions = rows.map((r) => r.position).sort((a, b) => a - b);
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.cat, (count.get(r.cat) || 0) + 1);
  let cum = 0;
  return ORDER.filter((c) => count.get(c)).map((cat) => {
    const players = count.get(cat)!;
    cum += players;
    return { cat, ord: ORDER.indexOf(cat), players, lastPosition: positions[cum - 1] };
  });
}

export async function refreshLimits() {
  const limits = await computeLimits();
  const day = today();
  await db
    .insert(classLimits)
    .values(limits.map((l) => ({ ...l, day })))
    .onConflictDoUpdate({
      target: [classLimits.day, classLimits.cat],
      set: { ord: sql`excluded.ord`, players: sql`excluded.players`, lastPosition: sql`excluded.last_position`, updatedAt: sql`now()` },
    });
  return limits;
}

// Derniers seuils calculés (ou [] s'il n'y en a pas encore).
export async function latestLimits() {
  const [last] = await db.select({ day: classLimits.day }).from(classLimits).orderBy(desc(classLimits.day)).limit(1);
  if (!last) return { day: "", limits: [] as { cat: string; players: number; lastPosition: number }[] };
  const rows = await db
    .select({ cat: classLimits.cat, players: classLimits.players, lastPosition: classLimits.lastPosition })
    .from(classLimits)
    .where(eq(classLimits.day, last.day))
    .orderBy(classLimits.ord);
  return { day: String(last.day), limits: rows };
}
