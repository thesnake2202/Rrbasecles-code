CREATE TABLE "ranking_snapshots" (
	"licence" text,
	"day" date,
	"position" integer NOT NULL,
	"points" real,
	"cat" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY("licence","day")
);
