CREATE INDEX "accident_reports_tenant_customer_occurred_idx" ON "accident_reports" USING btree ("tenant_id","customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "daily_reports_tenant_customer_occurred_idx" ON "daily_reports" USING btree ("tenant_id","customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "family_members_tenant_customer_idx" ON "family_members" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "receipts_tenant_customer_timestamp_idx" ON "receipts" USING btree ("tenant_id","customer_id","receipt_timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_tenant_staff_idx" ON "sessions" USING btree ("tenant_id","staff_id");