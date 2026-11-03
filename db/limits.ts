// Paliers des classements lettres (A, B0 … E6) d'après le tableau d'équivalence officiel AFTT 2026-2027.
// Le tableau donne, selon le nombre total de joueurs actifs (tranches de 500), la dernière place du classement
// numérique (sans les inactifs) qui correspond à chaque classement : les 20 premiers sont « A », jusqu'à la 75e
// « B0 », etc. On relève aussi les points du joueur situé à chaque palier, pour savoir combien de points il faut
// gagner (ou combien on peut en perdre) pour changer de classement.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
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

// Tableau d'équivalence Messieurs 2026-2027 (nombre d'actifs à partir de E6). Colonne k = tranche
// de 11 750 + 500·k à 12 249 + 500·k joueurs actifs.
export const TABLE: Record<string, number[]> = {
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
export const column = (actives: number) => Math.min(16, Math.max(0, Math.floor((actives - 11750) / 500)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Page « Outils » de l'AFTT : nombre officiel de joueurs actifs (hors NC) du classement mixte et date du dernier calcul.
export const TOOLS_URL = `${BASE}/tools/index.php?lang=en`;

export async function fetchActives(): Promise<{ actives: number; calc: string }> {
  const res = await fetch(TOOLS_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`AFTT outils ${res.status}`);
  const html = await res.text();
  // Premier compteur = « joueurs actifs hors NC » (classement mixte général), le second concerne les dames.
  const m = html.match(/ranking-stat-value">([^<]*)<\/div>\s*<p class="ranking-stat-label">\s*joueurs actifs/i);
  const actives = Number((m?.[1] || "").replace(/\D/g, ""));
  if (!actives) throw new Error("Nombre de joueurs actifs introuvable sur la page Outils AFTT");
  const calc = ((html.match(/Dernier calcul mixte termin[^:]*:\s*([^<]*)/) || [])[1] || "").trim();
  return { actives, calc };
}

type Row = { position: number; cat: string; points: number };

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
        position: Number(((m[0].match(/rank-pill[^"]*">([^<]*)/) || [])[1] || "").replace(/\D/g, "")) || 0,
        cat: letter((m[0].match(/ranking-badge">([^<]*)/) || [])[1] || ""),
        points: Number(((m[0].match(/points-cell">([^<]*)/) || [])[1] || "").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
      }));
      return { rows, pages };
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

// Prend le nombre officiel de joueurs actifs sur la page Outils AFTT (repli : comptage du classement), parcourt
// tout le classement mixte pour relever les points à chaque palier et applique le tableau d'équivalence.
export async function computeLimits() {
  const official = await fetchActives().catch((e) => (console.error(e), null));
  const first = await page(1);
  if (!first.pages || !first.rows.length) throw new Error("Classement AFTT vide");
  const all: Row[][] = [first.rows];
  // Une page à la fois, avec une courte pause, pour ménager le site de l'AFTT.
  for (let n = 2; n <= first.pages; n++) {
    await sleep(1500);
    all.push((await page(n)).rows);
  }
  const rows = all
    .flat()
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position);
  // Repli : comptage des joueurs classés hors NC, comme le compteur officiel AFTT.
  const actives = official?.actives || rows.filter((r) => r.cat && r.cat !== "NC").length;
  const afttCalc = official?.calc || null;
  const k = column(actives);
  // Les places du tableau se comptent dans le classement numérique sans les NC. Dans le classement AFTT, les NC
  // occupent une place (dès ~8 300e) : la place d'un actif = son rang AFTT moins le nombre de NC classés devant lui.
  // Pour chaque palier, on retient le rang AFTT et les points du dernier actif dont la place reste dans le palier
  // (le rang AFTT reste ainsi directement comparable à celui des joueurs du club).
  const act: (Row & { place: number })[] = [];
  let nc = 0;
  for (const r of rows) {
    if (!r.cat || r.cat === "NC") {
      if (r.cat === "NC") nc++;
      continue;
    }
    act.push({ ...r, place: r.position - nc });
  }
  const lastRank = rows[rows.length - 1].position;
  let prev = 0;
  return Object.entries(TABLE).map(([cat, cols]) => {
    const place = cols[k];
    // Dernier actif à l'intérieur du palier (aucun si le palier couvre tous les actifs).
    const at = place <= (act.at(-1)?.place || 0) ? act.filter((r) => r.place <= place).at(-1) : undefined;
    const lastPosition = at ? at.position : lastRank;
    const players = place - prev;
    prev = place;
    return { cat, ord: ORDER.indexOf(cat), players, lastPosition, points: at ? at.points : null, actives, afttCalc };
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
      set: {
        ord: sql`excluded.ord`,
        players: sql`excluded.players`,
        lastPosition: sql`excluded.last_position`,
        points: sql`excluded.points`,
        actives: sql`excluded.actives`,
        afttCalc: sql`excluded.aftt_calc`,
        updatedAt: sql`now()`,
      },
    });
  return limits;
}

// Derniers paliers calculés avec le tableau officiel (ou [] s'il n'y en a pas encore).
export async function latestLimits() {
  const [last] = await db
    .select({ day: classLimits.day, actives: classLimits.actives, afttCalc: classLimits.afttCalc })
    .from(classLimits)
    .where(isNotNull(classLimits.actives))
    .orderBy(desc(classLimits.day))
    .limit(1);
  type Limit = { cat: string; players: number; lastPosition: number; points: number | null };
  if (!last) return { day: "", actives: 0, afttCalc: "", limits: [] as Limit[] };
  const rows: Limit[] = await db
    .select({ cat: classLimits.cat, players: classLimits.players, lastPosition: classLimits.lastPosition, points: classLimits.points })
    .from(classLimits)
    .where(and(eq(classLimits.day, last.day), isNotNull(classLimits.actives)))
    .orderBy(classLimits.ord);
  return { day: String(last.day), actives: last.actives || 0, afttCalc: last.afttCalc || "", limits: rows };
}
