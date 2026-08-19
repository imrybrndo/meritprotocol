-- Anchoring moved from Solana to an EVM chain.
--
-- Only the column default changes. Existing rows keep whatever chain they were
-- written with: an agent that genuinely operated on Solana did so, and quietly
-- rewriting its record to say otherwise would be exactly the kind of retroactive
-- edit this protocol refuses everywhere else.
--
-- Backfilling is therefore a deliberate, separate decision. If every existing
-- row is demo data that was never on Solana in the first place, this is the
-- statement to run by hand:
--
--   UPDATE "agents" SET "chain" = 'robinhood' WHERE "chain" = 'solana';

ALTER TABLE "agents" ALTER COLUMN "chain" SET DEFAULT 'robinhood';
