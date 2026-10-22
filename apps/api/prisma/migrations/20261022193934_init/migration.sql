-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('SYNTHETIC', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PROCESSING', 'FAILED_VALIDATION', 'RECONCILIATION_FAILED', 'READY_TO_PUBLISH', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('NOT_RUN', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationMetric" AS ENUM ('NET_AMOUNT', 'LINE_COUNT', 'QUANTITY');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('F2', 'G2', 'RE', 'S1');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "data_classification" "DataClassification" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_type" VARCHAR(40) NOT NULL DEFAULT 'SAP_BILLING_CSV',
    "file_name" VARCHAR(255) NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'NOT_RUN',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_valid" INTEGER NOT NULL DEFAULT 0,
    "rows_invalid" INTEGER NOT NULL DEFAULT 0,
    "rows_duplicate_in_file" INTEGER NOT NULL DEFAULT 0,
    "rows_already_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_inserted" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "created_by_user_id" UUID,
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "billing_document" VARCHAR(20) NOT NULL,
    "billing_item" VARCHAR(10) NOT NULL,
    "billing_type" "BillingType" NOT NULL,
    "billing_date" DATE NOT NULL,
    "cancelled_billing_document" VARCHAR(20),
    "distributor_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "sales_unit" VARCHAR(10) NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "metric" "ReconciliationMetric" NOT NULL,
    "month" CHAR(7) NOT NULL,
    "currency" CHAR(3),
    "unit" VARCHAR(10),
    "expected_value" DECIMAL(20,3) NOT NULL,
    "actual_value" DECIMAL(20,3) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "import_batches_organization_id_status_idx" ON "import_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "import_batches_organization_id_file_sha256_idx" ON "import_batches"("organization_id", "file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_organization_id_id_key" ON "import_batches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "distributors_organization_id_code_key" ON "distributors"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "distributors_organization_id_id_key" ON "distributors"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_code_key" ON "customers"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "sales_transactions_organization_id_billing_date_idx" ON "sales_transactions"("organization_id", "billing_date");

-- CreateIndex
CREATE INDEX "sales_transactions_organization_id_import_batch_id_idx" ON "sales_transactions"("organization_id", "import_batch_id");

-- CreateIndex
CREATE INDEX "sales_transactions_organization_id_distributor_id_idx" ON "sales_transactions"("organization_id", "distributor_id");

-- CreateIndex
CREATE INDEX "sales_transactions_organization_id_product_id_idx" ON "sales_transactions"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "sales_transactions_organization_id_customer_id_idx" ON "sales_transactions"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transactions_organization_id_billing_document_billing_key" ON "sales_transactions"("organization_id", "billing_document", "billing_item");

-- CreateIndex
CREATE INDEX "reconciliation_results_organization_id_import_batch_id_idx" ON "reconciliation_results"("organization_id", "import_batch_id");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_organization_id_import_batch_id_fkey" FOREIGN KEY ("organization_id", "import_batch_id") REFERENCES "import_batches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_organization_id_distributor_id_fkey" FOREIGN KEY ("organization_id", "distributor_id") REFERENCES "distributors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_organization_id_product_id_fkey" FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_organization_id_import_batch_id_fkey" FOREIGN KEY ("organization_id", "import_batch_id") REFERENCES "import_batches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written guardrails (Prisma schema cannot express CHECK constraints).
-- Sign rules: invoices are non-negative; credit memos, returns and cancellations are non-positive.
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_sign_check" CHECK (
  (billing_type = 'F2' AND net_amount >= 0 AND quantity >= 0)
  OR (billing_type = 'G2' AND net_amount <= 0 AND quantity = 0)
  OR (billing_type IN ('RE', 'S1') AND net_amount <= 0 AND quantity <= 0)
);
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_currency_check" CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_s1_reference_check" CHECK (
  billing_type <> 'S1' OR cancelled_billing_document IS NOT NULL
);
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_month_check" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_sha_check" CHECK (file_sha256 ~ '^[0-9a-f]{64}$');
