# Central de Mudanças

CRM simples para uma empresa de mudanças: clientes, funil de negociação, agenda e tarefas — tudo cadastrado manualmente, sem integrações externas.

Tem login: cada usuário cria sua própria conta e só enxerga os clientes, compromissos e tarefas que cadastrou.

## Como rodar

```bash
npm install
npx prisma db push   # cria o banco de dados (só precisa rodar uma vez)
npm run dev
```

Acesse http://localhost:3000 e crie uma conta em "Criar conta".

É preciso definir `SESSION_SECRET` no `.env` (uma string aleatória qualquer, usada para assinar o cookie de sessão) — veja `.env` para o valor já gerado neste projeto.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Prisma + SQLite** (`prisma/dev.db`) — banco local em arquivo único, fácil de fazer backup (basta copiar o arquivo)
- **bcryptjs** para hash de senha; sessão via cookie HttpOnly assinado (HMAC), sem serviço externo de auth
- Nenhuma outra dependência externa em tempo de execução (sem IA, sem WhatsApp API, sem serviços de terceiros)

## Estrutura

- `prisma/schema.prisma` — modelos: `User`, `Client`, `HistoryEntry`, `Appointment`, `Task` (Client/Appointment/Task pertencem a um `User` via `userId`)
- `src/app/(auth)` — páginas públicas de login e registro
- `src/app/(app)` — páginas protegidas (Início, Clientes, Funil, Agenda, Tarefas, Mudanças); o layout deste grupo exige login
- `src/middleware.ts` — redireciona visitantes não autenticados para `/login`
- `src/lib/auth.ts` — sessão (cookie assinado), hash/verificação de senha, `requireUserId()` usado em toda página e Server Action para escopar os dados por usuário
- `src/app/actions` — Server Actions (todas as escritas no banco passam por aqui, sempre validando o dono do registro)
- `src/lib/constants.ts` — status do funil e tipos de compromisso (única fonte da verdade)

## Seed de dados de teste

`node prisma/seed.js` popula clientes/tarefas/compromissos de exemplo para o usuário mais antigo cadastrado — crie uma conta pela tela de registro antes de rodar.

## Escopo

Este é o MVP: cadastro manual apenas. A arquitetura (Server Actions isoladas, schema com `Appointment`/`HistoryEntry` desacoplados) foi pensada para permitir, no futuro, integrações como WhatsApp, automações e IA — mas nada disso está implementado agora.
