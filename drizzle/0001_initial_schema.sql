CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"section_title" text NOT NULL,
	"section_refs" text[] NOT NULL,
	"token_estimate" integer NOT NULL,
	"text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED NOT NULL,
	"embedding" vector(1536),
	CONSTRAINT "chunks_document_index" UNIQUE("document_id","chunk_index"),
	CONSTRAINT "chunks_page_range" CHECK ("chunks"."page_start" >= 1 AND "chunks"."page_start" <= "chunks"."page_end")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"source_id" text,
	"status" text NOT NULL,
	"review_reason" text,
	"doc_type" text,
	"extraction_method" text NOT NULL,
	"extraction_trace" jsonb NOT NULL,
	"text_quality" text NOT NULL,
	"text_quality_score" real NOT NULL,
	"text_coverage" real NOT NULL,
	"page_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "documents_id_is_sha256" CHECK ("documents"."id" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"field" text NOT NULL,
	"status" text NOT NULL,
	"value" jsonb,
	"page_start" integer,
	"page_end" integer,
	"quote" text,
	"confidence" real,
	"validation_errors" jsonb,
	"model" text NOT NULL,
	"prompt_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extractions_run_field" UNIQUE("run_id","field")
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"document_id" text,
	"prompt_sha256" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"document_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"printed_label" text,
	"source" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "pages_document_id_page_number_pk" PRIMARY KEY("document_id","page_number"),
	CONSTRAINT "pages_page_number_positive" CHECK ("pages"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid NOT NULL,
	"action" text NOT NULL,
	"corrected_value" jsonb,
	"corrected_page" integer,
	"corrected_quote" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_correction_has_value" CHECK ("reviews"."action" = 'approve' OR "reviews"."corrected_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"doc_type" text NOT NULL,
	"confidence" real NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_page_range" CHECK ("segments"."page_start" >= 1 AND "segments"."page_start" <= "segments"."page_end")
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_section_refs_idx" ON "chunks" USING gin ("section_refs");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "extractions_document_idx" ON "extractions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");