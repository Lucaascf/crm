-- Aplicar uma vez no banco alvo antes de iniciar o código atualizado.
-- Migração aditiva: preserva orçamento e todos os dados existentes.
BEGIN TRANSACTION;
ALTER TABLE "Client" ADD COLUMN "commercialNotes" TEXT;
ALTER TABLE "Client" ADD COLUMN "clientNickname" TEXT;
COMMIT;
