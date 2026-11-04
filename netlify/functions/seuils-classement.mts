// Calcul (en arrière-plan) des paliers des classements lettres (tableau d'équivalence AFTT + classement numérique).
// Déclenché chaque jour par le relevé automatique, toutes les heures par la surveillance de la page Outils AFTT
// lorsque le nombre de joueurs actifs change, ou à la demande si aucun seuil n'existe encore.
import type { Config } from "@netlify/functions";
import { fetchActives, latestLimits, refreshLimits } from "../../db/limits.js";
import { today } from "../../db/snapshots.js";

export default async () => {
  const last = await latestLimits();
  if (last.day === today()) {
    // Déjà calculé aujourd'hui : on ne refait le calcul que si l'AFTT a publié un nouveau comptage des actifs.
    const now = await fetchActives().catch(() => null);
    if (!now || (now.actives === last.actives && now.calc === last.afttCalc))
      return console.log("Seuils déjà à jour (nombre d'actifs AFTT inchangé).");
  }
  const limits = await refreshLimits();
  console.log(`Paliers enregistrés (${limits[0]?.actives} actifs) : ${limits.map((l) => `${l.cat}≤${l.lastPosition} (${l.points ?? "–"} pts)`).join(", ")}`);
};

export const config: Config = { path: "/api/seuils-classement", background: true };
