// Calcul (en arrière-plan) des seuils estimés des classements lettres à partir du classement numérique AFTT.
// Déclenché chaque jour par le relevé automatique, ou à la demande si aucun seuil n'existe encore.
import type { Config } from "@netlify/functions";
import { latestLimits, refreshLimits } from "../../db/limits.js";
import { today } from "../../db/snapshots.js";

export default async () => {
  const { day } = await latestLimits();
  if (day === today()) return console.log("Seuils déjà calculés aujourd'hui.");
  const limits = await refreshLimits();
  console.log(`Seuils de classement enregistrés : ${limits.map((l) => `${l.cat}≤${l.lastPosition}`).join(", ")}`);
};

export const config: Config = { path: "/api/seuils-classement", background: true };
