// Reaproveita o Prisma Client já gerado pelo app Next.js do CRM (mesmo
// schema, mesmo banco — ver /root/crm/prisma/schema.prisma). Node resolve
// o pacote @prisma/client subindo até /root/crm/node_modules, já que o
// whatsapp-bot não tem cópia própria.
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
