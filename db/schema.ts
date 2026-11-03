import { pgTable, text, integer, real, date, timestamp, primaryKey } from "drizzle-orm/pg-core";

// Un relevé par joueur et par jour de sa position au classement numérique AFTT (sans les inactifs).
export const rankingSnapshots = pgTable(
  "ranking_snapshots",
  {
    licence: text().notNull(),
    day: date().notNull(),
    position: integer().notNull(),
    points: real(),
    cat: text(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.licence, t.day] })],
);

// Seuils estimés des classements lettres : pour chaque relevé, la dernière position (classement numérique
// sans les inactifs) couverte par chaque classement, d'après le nombre de joueurs actifs qui le détiennent.
export const classLimits = pgTable(
  "class_limits",
  {
    day: date().notNull(),
    cat: text().notNull(),
    ord: integer().notNull(),
    players: integer().notNull(),
    lastPosition: integer("last_position").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.cat] })],
);
