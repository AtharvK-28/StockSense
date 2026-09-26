-- Login IDs (backfilled from the email's local part for existing users).
ALTER TABLE "users" ADD COLUMN "login_id" TEXT;
UPDATE "users" SET "login_id" = left(regexp_replace(split_part("email", '@', 1), '[^A-Za-z0-9._]', '', 'g'), 8) || substr(md5("id"::text), 1, 4);
ALTER TABLE "users" ALTER COLUMN "login_id" SET NOT NULL;
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

ALTER TABLE "locations" ADD COLUMN "code" TEXT;
ALTER TABLE "products" ADD COLUMN "unit_cost" DECIMAL(14,2);
ALTER TABLE "documents" ADD COLUMN "delivery_address" TEXT;
