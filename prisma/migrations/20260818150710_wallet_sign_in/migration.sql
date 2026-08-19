-- AlterTable
ALTER TABLE "users" ADD COLUMN     "walletAddress" TEXT;

-- CreateTable
CREATE TABLE "wallet_challenges" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_walletAddress_key" ON "users"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_challenges_nonce_key" ON "wallet_challenges"("nonce");

-- CreateIndex
CREATE INDEX "wallet_challenges_address_expiresAt_idx" ON "wallet_challenges"("address", "expiresAt");
