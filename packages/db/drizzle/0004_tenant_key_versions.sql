/*
  DEKの世代(dek_version)を並存させるため、主キーを (tenant_id) から
  (tenant_id, dek_version) の複合に張り替える。1テナント1行のままだと、DEKを
  ローテーションした瞬間に旧世代で暗号化された既存の暗号文がすべて読めなくなる
  (packages/db/src/schema/tenantKeys.ts のコメント参照)。

  既存の主キー制約名は、0000_init_schema.sql の `"tenant_id" uuid PRIMARY KEY` に対して
  PostgreSQLが自動採番した "tenant_keys_pkey"。drizzle-kit はこの名前を出力できないため
  手で書いている(FORCE ROW LEVEL SECURITY と同じく、生成後に手を入れている箇所)。
*/
ALTER TABLE "tenant_keys" DROP CONSTRAINT "tenant_keys_pkey";--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_dek_version_pk" PRIMARY KEY("tenant_id","dek_version");
