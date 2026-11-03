CREATE TABLE "class_limits" (
	"day" date,
	"cat" text,
	"ord" integer NOT NULL,
	"players" integer NOT NULL,
	"last_position" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "class_limits_pkey" PRIMARY KEY("day","cat")
);
