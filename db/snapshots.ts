import { asc, eq, sql } from "drizzle-orm";
import { db } from "./index.js";
import { rankingSnapshots } from "./schema.js";

export type Snapshot = { licence: string; position: number; points?: number; cat?: string };

// Date du jour en Belgique (AAAA-MM-JJ).
export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });

// Enregistre (ou met à jour) la position du jour pour chaque joueur.
export async function saveSnapshots(rows: Snapshot[]) {
  const day = today();
  const values = rows
    .filter((r) => r.licence && Number.isInteger(r.position) && r.position > 0)
    .map((r) => ({ licence: r.licence, day, position: r.position, points: r.points ?? null, cat: r.cat || null }));
  if (!values.length) return 0;
  await db
    .insert(rankingSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [rankingSnapshots.licence, rankingSnapshots.day],
      set: {
        position: sql`excluded.position`,
        points: sql`coalesce(excluded.points, ${rankingSnapshots.points})`,
        cat: sql`coalesce(excluded.cat, ${rankingSnapshots.cat})`,
        updatedAt: sql`now()`,
      },
    });
  return values.length;
}

export async function rankHistory(licence: string) {
  const rows = await db
    .select({ date: rankingSnapshots.day, position: rankingSnapshots.position, cat: rankingSnapshots.cat })
    .from(rankingSnapshots)
    .where(eq(rankingSnapshots.licence, licence))
    .orderBy(asc(rankingSnapshots.day));
  return rows.map((r) => ({ date: String(r.date), position: r.position, cat: r.cat || "" }));
}
