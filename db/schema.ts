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
