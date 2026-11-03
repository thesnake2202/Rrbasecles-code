// Surveillance régulière de la page Outils AFTT (https://data.aftt.be/tools/index.php?lang=en) : nombre de joueurs
// actifs hors NC et date du dernier calcul mixte. Si l'un des deux change, les paliers sont recalculés.
import type { Config } from "@netlify/functions";
import { fetchActives, latestLimits } from "../../db/limits.js";

export default async () => {
  const [now, last] = await Promise.all([fetchActives(), latestLimits()]);
  if (now.actives === last.actives && now.calc === last.afttCalc)
    return console.log(`Page Outils AFTT inchangée (${now.actives} actifs, calcul du ${now.calc}).`);
  console.log(`Nouveau comptage AFTT : ${now.actives} actifs (calcul du ${now.calc}), avant ${last.actives || "–"}. Recalcul des paliers.`);
  const site = Netlify.env.get("URL");
  if (site) await fetch(`${site}/api/seuils-classement`, { method: "POST" }).catch((e) => console.error(e));
};

// Toutes les heures.
export const config: Config = { schedule: "@hourly" };
