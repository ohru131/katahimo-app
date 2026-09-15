-- 日報AIのプロンプト調整(doc/db/new-domains.md 第6章)。
--
-- GAS版が「ＡＩプロンプト」シートに置いていたプロンプト文面の置き場所を DB に移し(prompt_templates)、
-- 保護者向け文面を「子の年齢帯 × 家庭の教育関心度 × 保護者のストレス度」の3軸で組み替えるための
-- 表(report_age_bands / report_keywords / report_education_levels / report_stress_levels / report_phrases /
-- customer_report_profiles)と、AI生成1回ごとの記録(report_ai_generations / report_ai_generation_keywords)を足す。
--
-- daily_reports には「主に描いている子」(target_family_member_id)と「保存した本文の元になった生成」
-- (ai_generation_id)の2列を足す。どちらも null 許容で、既存行はそのまま通る。
-- family_members には (tenant_id, id) の UNIQUE を足す(上の2表からの複合FKの参照先)。
--
-- 【drizzle-kitが生成できず手で追記している部分】(このファイル末尾)
-- 0001 と同じく FORCE ROW LEVEL SECURITY と set_updated_at トリガーは生成されないため、
-- 新設した10表のぶんを手で足している。追記漏れは
-- packages/db/src/rlsPolicies.test.ts / updatedAtTriggers.test.ts が検出する。
-- prompt_templates / report_ai_generations / report_ai_generation_keywords / report_age_band_keywords は
-- updated_at を持たない(追記のみ、または対応表)ためトリガーは付けない。

CREATE TABLE "customer_report_profiles" (
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"education_level" integer,
	"note" text DEFAULT '' NOT NULL,
	"updated_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_report_profiles_pk" PRIMARY KEY("tenant_id","customer_id"),
	CONSTRAINT "customer_report_profiles_education_level_check" CHECK ("customer_report_profiles"."education_level" IS NULL
        OR "customer_report_profiles"."education_level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "customer_report_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_templates_tenant_key_version_uk" UNIQUE("tenant_id","key","version"),
	CONSTRAINT "prompt_templates_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "prompt_templates_key_check" CHECK ("prompt_templates"."key" IN ('daily_report', 'daily_report_stance', 'accident_report', 'receipt_ocr', 'daily_memo_placeholder', 'accident_memo_placeholder', 'accident_hint', 'hiyari_hint')),
	CONSTRAINT "prompt_templates_version_check" CHECK ("prompt_templates"."version" >= 1),
	CONSTRAINT "prompt_templates_body_not_blank" CHECK (NULLIF(btrim("prompt_templates"."body"), '') IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "prompt_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_age_band_keywords" (
	"tenant_id" uuid NOT NULL,
	"age_band_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "report_age_band_keywords_pk" PRIMARY KEY("tenant_id","age_band_id","keyword_id")
);
--> statement-breakpoint
ALTER TABLE "report_age_band_keywords" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_age_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"age_from_months" integer NOT NULL,
	"age_to_months" integer NOT NULL,
	"behavior_words" text DEFAULT '' NOT NULL,
	"development_topics" text DEFAULT '' NOT NULL,
	"scene_examples" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_age_bands_tenant_code_uk" UNIQUE("tenant_id","code"),
	CONSTRAINT "report_age_bands_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_age_bands_code_not_blank" CHECK (NULLIF(btrim("report_age_bands"."code"), '') IS NOT NULL),
	CONSTRAINT "report_age_bands_age_range_check" CHECK ("report_age_bands"."age_from_months" >= 0
        AND "report_age_bands"."age_to_months" > "report_age_bands"."age_from_months"
        AND "report_age_bands"."age_to_months" <= 144)
);
--> statement-breakpoint
ALTER TABLE "report_age_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_ai_generation_keywords" (
	"tenant_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "report_ai_generation_keywords_pk" PRIMARY KEY("tenant_id","generation_id","keyword_id","role"),
	CONSTRAINT "report_ai_generation_keywords_role_check" CHECK ("report_ai_generation_keywords"."role" IN ('candidate', 'used'))
);
--> statement-breakpoint
ALTER TABLE "report_ai_generation_keywords" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"target_family_member_id" uuid,
	"prompt_template_id" uuid,
	"model" text NOT NULL,
	"child_age_months" integer,
	"education_level" integer,
	"effective_education_level" integer,
	"stress_level" integer,
	"escalation_required" boolean DEFAULT false NOT NULL,
	"input_text" text NOT NULL,
	"time_info" text DEFAULT '' NOT NULL,
	"output_json" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_ai_generations_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_ai_generations_levels_check" CHECK (("report_ai_generations"."education_level" IS NULL
          OR "report_ai_generations"."education_level" BETWEEN 1 AND 5)
        AND ("report_ai_generations"."effective_education_level" IS NULL
          OR "report_ai_generations"."effective_education_level" BETWEEN 1 AND 5)
        AND ("report_ai_generations"."stress_level" IS NULL
          OR "report_ai_generations"."stress_level" BETWEEN 1 AND 5)),
	CONSTRAINT "report_ai_generations_child_age_check" CHECK ("report_ai_generations"."child_age_months" IS NULL OR "report_ai_generations"."child_age_months" BETWEEN 0 AND 144),
	CONSTRAINT "report_ai_generations_outcome_check" CHECK (("report_ai_generations"."output_json" IS NULL) <> ("report_ai_generations"."error_message" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "report_ai_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_education_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prompt_instruction" text DEFAULT '' NOT NULL,
	"max_keywords" integer DEFAULT 1 NOT NULL,
	"allow_term_names" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_education_levels_tenant_level_uk" UNIQUE("tenant_id","level"),
	CONSTRAINT "report_education_levels_level_check" CHECK ("report_education_levels"."level" BETWEEN 1 AND 5),
	CONSTRAINT "report_education_levels_max_keywords_check" CHECK ("report_education_levels"."max_keywords" BETWEEN 0 AND 3)
);
--> statement-breakpoint
ALTER TABLE "report_education_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"sub_concept" text DEFAULT '' NOT NULL,
	"age_from_months" integer NOT NULL,
	"age_to_months" integer NOT NULL,
	"education_level_min" integer NOT NULL,
	"education_level_max" integer NOT NULL,
	"stress_level_min" integer NOT NULL,
	"tone" text DEFAULT '' NOT NULL,
	"parent_explanation" text DEFAULT '' NOT NULL,
	"phrase_examples" text DEFAULT '' NOT NULL,
	"usage_scene" text DEFAULT '' NOT NULL,
	"ng_example" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_keywords_tenant_code_uk" UNIQUE("tenant_id","code"),
	CONSTRAINT "report_keywords_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_keywords_code_not_blank" CHECK (NULLIF(btrim("report_keywords"."code"), '') IS NOT NULL),
	CONSTRAINT "report_keywords_name_not_blank" CHECK (NULLIF(btrim("report_keywords"."name"), '') IS NOT NULL),
	CONSTRAINT "report_keywords_age_range_check" CHECK ("report_keywords"."age_from_months" >= 0
        AND "report_keywords"."age_to_months" > "report_keywords"."age_from_months"
        AND "report_keywords"."age_to_months" <= 144),
	CONSTRAINT "report_keywords_education_level_check" CHECK ("report_keywords"."education_level_min" BETWEEN 1 AND 5
        AND "report_keywords"."education_level_max" BETWEEN 1 AND 5
        AND "report_keywords"."education_level_min" <= "report_keywords"."education_level_max"),
	CONSTRAINT "report_keywords_stress_level_check" CHECK ("report_keywords"."stress_level_min" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "report_keywords" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"stress_level_min" integer DEFAULT 1 NOT NULL,
	"stress_level_max" integer DEFAULT 5 NOT NULL,
	"placement" text DEFAULT 'any' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_phrases_kind_check" CHECK ("report_phrases"."kind" IN ('encourage', 'avoid')),
	CONSTRAINT "report_phrases_placement_check" CHECK ("report_phrases"."placement" IN ('any', 'closing')),
	CONSTRAINT "report_phrases_body_not_blank" CHECK (NULLIF(btrim("report_phrases"."body"), '') IS NOT NULL),
	CONSTRAINT "report_phrases_stress_level_check" CHECK ("report_phrases"."stress_level_min" BETWEEN 1 AND 5
        AND "report_phrases"."stress_level_max" BETWEEN 1 AND 5
        AND "report_phrases"."stress_level_min" <= "report_phrases"."stress_level_max")
);
--> statement-breakpoint
ALTER TABLE "report_phrases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_stress_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"label" text NOT NULL,
	"criteria" text DEFAULT '' NOT NULL,
	"prompt_instruction" text DEFAULT '' NOT NULL,
	"education_level_shift" integer DEFAULT 0 NOT NULL,
	"keywords_enabled" boolean DEFAULT true NOT NULL,
	"escalation_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_stress_levels_tenant_level_uk" UNIQUE("tenant_id","level"),
	CONSTRAINT "report_stress_levels_level_check" CHECK ("report_stress_levels"."level" BETWEEN 1 AND 5),
	CONSTRAINT "report_stress_levels_shift_check" CHECK ("report_stress_levels"."education_level_shift" BETWEEN -4 AND 0)
);
--> statement-breakpoint
ALTER TABLE "report_stress_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- 参照先の UNIQUE は、それを指す複合FK(下の report_ai_generations / daily_reports)より前に作る
-- (drizzle-kit はこの順で生成しないため手で動かしている)。
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_id_uk" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "target_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "ai_generation_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_report_profiles" ADD CONSTRAINT "customer_report_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_report_profiles" ADD CONSTRAINT "customer_report_profiles_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_report_profiles" ADD CONSTRAINT "customer_report_profiles_tenant_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_tenant_created_by_fk" FOREIGN KEY ("tenant_id","created_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_age_band_keywords" ADD CONSTRAINT "report_age_band_keywords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_age_band_keywords" ADD CONSTRAINT "report_age_band_keywords_tenant_band_fk" FOREIGN KEY ("tenant_id","age_band_id") REFERENCES "public"."report_age_bands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_age_band_keywords" ADD CONSTRAINT "report_age_band_keywords_tenant_keyword_fk" FOREIGN KEY ("tenant_id","keyword_id") REFERENCES "public"."report_keywords"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_age_bands" ADD CONSTRAINT "report_age_bands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generation_keywords" ADD CONSTRAINT "report_ai_generation_keywords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generation_keywords" ADD CONSTRAINT "report_ai_generation_keywords_tenant_generation_fk" FOREIGN KEY ("tenant_id","generation_id") REFERENCES "public"."report_ai_generations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generation_keywords" ADD CONSTRAINT "report_ai_generation_keywords_tenant_keyword_fk" FOREIGN KEY ("tenant_id","keyword_id") REFERENCES "public"."report_keywords"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generations" ADD CONSTRAINT "report_ai_generations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generations" ADD CONSTRAINT "report_ai_generations_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generations" ADD CONSTRAINT "report_ai_generations_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generations" ADD CONSTRAINT "report_ai_generations_tenant_target_family_member_fk" FOREIGN KEY ("tenant_id","target_family_member_id") REFERENCES "public"."family_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_ai_generations" ADD CONSTRAINT "report_ai_generations_tenant_prompt_template_fk" FOREIGN KEY ("tenant_id","prompt_template_id") REFERENCES "public"."prompt_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_education_levels" ADD CONSTRAINT "report_education_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_keywords" ADD CONSTRAINT "report_keywords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_phrases" ADD CONSTRAINT "report_phrases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_stress_levels" ADD CONSTRAINT "report_stress_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_ai_generation_keywords_tenant_keyword_idx" ON "report_ai_generation_keywords" USING btree ("tenant_id","keyword_id","role");--> statement-breakpoint
CREATE INDEX "report_ai_generations_tenant_customer_created_idx" ON "report_ai_generations" USING btree ("tenant_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_phrases_tenant_kind_idx" ON "report_phrases" USING btree ("tenant_id","kind") WHERE "report_phrases"."active";--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_target_family_member_fk" FOREIGN KEY ("tenant_id","target_family_member_id") REFERENCES "public"."family_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_ai_generation_fk" FOREIGN KEY ("tenant_id","ai_generation_id") REFERENCES "public"."report_ai_generations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_report_profiles" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "prompt_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_age_band_keywords" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_age_bands" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_ai_generation_keywords" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_ai_generations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_education_levels" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_keywords" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_phrases" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_stress_levels" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
-- ▼ ここから下は drizzle-kit が生成しない。手で追記している(ファイル冒頭のコメント参照)。
ALTER TABLE "customer_report_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompt_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_age_band_keywords" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_age_bands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_ai_generation_keywords" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_ai_generations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_education_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_keywords" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_phrases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_stress_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "customer_report_profiles_set_updated_at" BEFORE UPDATE ON "customer_report_profiles"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_age_bands_set_updated_at" BEFORE UPDATE ON "report_age_bands"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_education_levels_set_updated_at" BEFORE UPDATE ON "report_education_levels"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_keywords_set_updated_at" BEFORE UPDATE ON "report_keywords"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_phrases_set_updated_at" BEFORE UPDATE ON "report_phrases"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_stress_levels_set_updated_at" BEFORE UPDATE ON "report_stress_levels"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
