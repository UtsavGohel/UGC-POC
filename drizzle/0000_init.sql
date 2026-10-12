CREATE TYPE "public"."angle_type" AS ENUM('problem_solution', 'testimonial', 'unboxing', 'before_after', 'reasons_why', 'social_proof', 'lifestyle', 'offer');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('static_ad', 'product_video', 'ugc_video');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('analyzing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "angles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "angle_type" NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"headline" text NOT NULL,
	"subheadline" text NOT NULL,
	"cta" text NOT NULL,
	"caption" text NOT NULL,
	"scene_idea" text NOT NULL,
	"voiceover" text NOT NULL,
	"product_shots" jsonb NOT NULL,
	"ugc_script" jsonb NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"angle_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"aspect_ratio" text NOT NULL,
	"status" "asset_status" DEFAULT 'queued' NOT NULL,
	"file_path" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"asset_id" uuid,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_url" text,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand" jsonb,
	"status" "product_status" DEFAULT 'analyzing' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "angles" ADD CONSTRAINT "angles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_angle_id_angles_id_fk" FOREIGN KEY ("angle_id") REFERENCES "public"."angles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "angles_product_idx" ON "angles" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "assets_product_idx" ON "assets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "assets_angle_idx" ON "assets" USING btree ("angle_id");--> statement-breakpoint
CREATE INDEX "cost_events_product_idx" ON "cost_events" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cost_events_created_idx" ON "cost_events" USING btree ("created_at");