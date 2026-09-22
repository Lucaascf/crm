-- Aplicar uma vez no banco alvo antes de iniciar o código atualizado.
-- Migração aditiva: preserva orçamento e todos os dados existentes.
-- Ver docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md (P1.1).
BEGIN TRANSACTION;
ALTER TABLE "Client" ADD COLUMN "movingCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "movingCancelledAt" DATETIME;
ALTER TABLE "Client" ADD COLUMN "cancellationEvidence" TEXT;
CREATE INDEX "Client_movingCancelled_idx" ON "Client"("movingCancelled");
COMMIT;
