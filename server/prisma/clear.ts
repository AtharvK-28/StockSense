/**
 * Empties every table (keeps the schema). TRUNCATE bypasses the ledger's append-only row
 * trigger by design — this is for resetting demo, test and e2e databases only.
 *
 *   npm run db:clear -w server && npm run db:seed -w server
 */
import { prisma } from "../src/db";

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE stock_ledger_entries, document_lines, documents, stock_levels, products,
             product_categories, locations, warehouses, otp_codes, users, sequences,
             notifications, audit_logs, app_settings CASCADE`);
  console.log("Cleared all data.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
