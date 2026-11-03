// Calcul (en arrière-plan) des paliers des classements lettres (tableau d'équivalence AFTT + classement numérique).
// Déclenché chaque jour par le relevé automatique, ou à la demande si aucun seuil n'existe encore.
import type { Config } from "@netlify/functions";
import { latestLimits, refreshLimits } from "../../db/limits.js";
import { today } from "../../db/snapshots.js";

export default async () => {
  const { day } = await latestLimits();
  if (day === today()) return console.log("Seuils déjà calculés aujourd'hui.");
  const limits = await refreshLimits();
  console.log(`Paliers enregistrés (${limits[0]?.actives} actifs) : ${limits.map((l) => `${l.cat}≤${l.lastPosition} (${l.points ?? "–"} pts)`).join(", ")}`);
};

export const config: Config = { path: "/api/seuils-classement", background: true };
