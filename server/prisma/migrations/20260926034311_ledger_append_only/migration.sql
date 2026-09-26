-- The stock ledger is append-only: history can be corrected only by writing a new
-- entry (e.g. an adjustment), never by editing or deleting an existing one.
CREATE OR REPLACE FUNCTION stock_ledger_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger_entries is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON "stock_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION stock_ledger_is_append_only();

-- Stock can never go negative, even if application checks are bypassed.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_quantity_non_negative" CHECK ("quantity" >= 0);
