// Popula o banco com clientes de teste que cobrem todas as funções do site:
// os 6 status do funil, compromissos dos 4 tipos, tarefas pendentes/concluídas,
// mudanças hoje/futura/passada e histórico de interações.
// Rode com: node prisma/seed.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function daysFromToday(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  const owner = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!owner) {
    throw new Error(
      "Nenhum usuário cadastrado ainda. Crie uma conta em /registro antes de rodar o seed."
    );
  }
  console.log(`Populando dados de teste para o usuário: ${owner.email}`);

  console.log("Limpando dados de teste anteriores...");
  await prisma.task.deleteMany({ where: { client: { whatsapp: { startsWith: "5511900" } } } });
  await prisma.appointment.deleteMany({ where: { client: { whatsapp: { startsWith: "5511900" } } } });
  await prisma.historyEntry.deleteMany({ where: { client: { whatsapp: { startsWith: "5511900" } } } });
  await prisma.client.deleteMany({ where: { whatsapp: { startsWith: "5511900" } } });
  await prisma.appointment.deleteMany({
    where: { title: { contains: "lead sem cadastro" } },
  });
  await prisma.task.deleteMany({
    where: { title: { contains: "caixas e plástico bolha" } },
  });

  // 1) NOVO_CONTATO — cadastro mínimo, acabou de chegar pelo WhatsApp.
  const client1 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Ana Beatriz Souza",
      whatsapp: "5511900010001",
      status: "NOVO_CONTATO",
      historyEntries: { create: { text: "Cliente cadastrado." } },
    },
  });

  // 2) EM_ATENDIMENTO — já informou endereços e tipo de imóvel, sem orçamento ainda.
  const client2 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Carlos Eduardo Lima",
      whatsapp: "5511900010002",
      status: "EM_ATENDIMENTO",
      originAddress: "Rua das Flores, 120 - Pinheiros, São Paulo/SP",
      destinationAddress: "Av. Paulista, 900 - Bela Vista, São Paulo/SP",
      propertyType: "Apartamento",
      movingNotes: "3 quartos, tem elevador nos dois endereços. Precisa de içamento? Confirmar.",
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Enviou fotos do apartamento pelo WhatsApp." },
          { text: "Agendada vistoria para hoje." },
        ],
      },
    },
  });

  // 3) ORCAMENTO_ENVIADO — orçamento já passado, mudança futura marcada.
  const client3 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Fernanda Ribeiro Costa",
      whatsapp: "5511900010003",
      status: "ORCAMENTO_ENVIADO",
      originAddress: "Rua Augusta, 500 - Consolação, São Paulo/SP",
      destinationAddress: "Rua Oscar Freire, 300 - Jardins, São Paulo/SP",
      movingDate: daysFromToday(7),
      propertyType: "Casa",
      movingNotes: "Tem piano de cauda, avisar equipe.",
      budgetValue: 3200,
      budgetNotes: "3 ambientes + piano. Inclui embalagem de louças.",
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Vistoria realizada." },
          { text: "Orçamento de R$ 3.200 enviado por WhatsApp." },
        ],
      },
    },
  });

  // 4) AGUARDANDO_CLIENTE — orçamento enviado, aguardando resposta, follow-up marcado.
  const client4 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Roberto Almeida Santos",
      whatsapp: "5511900010004",
      status: "AGUARDANDO_CLIENTE",
      originAddress: "Alameda Santos, 800 - Jardim Paulista, São Paulo/SP",
      destinationAddress: "Rua Harmonia, 200 - Sumaré, São Paulo/SP",
      movingDate: daysFromToday(14),
      propertyType: "Kitnet/Studio",
      budgetValue: 950,
      budgetNotes: "Studio pequeno, mudança simples.",
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Orçamento de R$ 950 enviado." },
          { text: "Cliente pediu 2 dias para decidir." },
        ],
      },
    },
  });

  // 5) FECHADO — negócio fechado, mudança marcada para HOJE (testa dashboard e /mudancas).
  const client5 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Juliana Pereira Martins",
      whatsapp: "5511900010005",
      status: "FECHADO",
      originAddress: "Rua Vergueiro, 1500 - Vila Mariana, São Paulo/SP",
      destinationAddress: "Rua dos Pinheiros, 700 - Pinheiros, São Paulo/SP",
      movingDate: daysFromToday(0),
      propertyType: "Apartamento",
      movingNotes: "Chegar cedo, prédio de destino só libera elevador de carga até 12h.",
      budgetValue: 2100,
      budgetNotes: "Fechado com desconto de 10% (indicação).",
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Orçamento de R$ 2.100 enviado." },
          { text: "Cliente aceitou e fechou negócio." },
          { text: "Mudança confirmada para hoje às 07:00." },
        ],
      },
    },
  });

  // 5b) FECHADO — mudança já realizada no passado (testa "Mudanças anteriores").
  const client5b = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Marcos Vinícius Oliveira",
      whatsapp: "5511900010006",
      status: "FECHADO",
      originAddress: "Rua Teodoro Sampaio, 400 - Pinheiros, São Paulo/SP",
      destinationAddress: "Rua Cardeal Arcoverde, 250 - Pinheiros, São Paulo/SP",
      movingDate: daysFromToday(-10),
      propertyType: "Sala comercial",
      budgetValue: 1800,
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Mudança realizada com sucesso." },
        ],
      },
    },
  });

  // 6) NAO_FECHOU — cliente que não fechou negócio.
  const client6 = await prisma.client.create({
    data: {
      userId: owner.id,
      name: "Patrícia Gomes Ferreira",
      whatsapp: "5511900010007",
      status: "NAO_FECHOU",
      originAddress: "Rua Bela Cintra, 100 - Consolação, São Paulo/SP",
      destinationAddress: "Rua Girassol, 50 - Vila Madalena, São Paulo/SP",
      propertyType: "Escritório",
      budgetValue: 4500,
      budgetNotes: "Achou o valor alto, fechou com concorrente.",
      historyEntries: {
        create: [
          { text: "Cliente cadastrado." },
          { text: "Orçamento de R$ 4.500 enviado." },
          { text: "Cliente informou que fechou com outra empresa." },
        ],
      },
    },
  });

  console.log("Clientes criados:", [client1, client2, client3, client4, client5, client5b, client6].length);

  // Compromissos — um de cada tipo, cobrindo hoje, futuro e sem cliente vinculado.
  await prisma.appointment.createMany({
    data: [
      {
        userId: owner.id,
        title: "Vistoria - Carlos Eduardo Lima",
        type: "VISTORIA",
        date: daysFromToday(0),
        time: "10:00",
        notes: "Levar trena e máquina fotográfica.",
        clientId: client2.id,
      },
      {
        userId: owner.id,
        title: "Retorno - Ana Beatriz Souza",
        type: "RETORNO",
        date: daysFromToday(0),
        time: "14:00",
        notes: "Confirmar se ainda tem interesse.",
        clientId: client1.id,
      },
      {
        userId: owner.id,
        title: "Follow-up - Roberto Almeida Santos",
        type: "FOLLOWUP",
        date: daysFromToday(0),
        time: "16:30",
        notes: "Ver se já decidiu sobre o orçamento.",
        clientId: client4.id,
      },
      {
        userId: owner.id,
        title: "Mudança - Juliana Pereira Martins",
        type: "MUDANCA",
        date: daysFromToday(0),
        time: "07:00",
        clientId: client5.id,
      },
      {
        userId: owner.id,
        title: "Vistoria - Fernanda Ribeiro Costa",
        type: "VISTORIA",
        date: daysFromToday(3),
        time: "11:00",
        clientId: client3.id,
      },
      {
        userId: owner.id,
        title: "Retorno - lead sem cadastro",
        type: "RETORNO",
        date: daysFromToday(1),
        time: "09:30",
        notes: "Ligou perguntando preço, ainda não virou cliente cadastrado.",
        clientId: null,
      },
    ],
  });

  // Tarefas — pendente hoje, pendente futura/sem cliente, atrasada e concluída.
  await prisma.task.create({
    data: {
      userId: owner.id,
      title: "Ligar confirmando horário da mudança",
      date: daysFromToday(0),
      time: "08:00",
      done: false,
      clientId: client5.id,
    },
  });
  await prisma.task.create({
    data: {
      userId: owner.id,
      title: "Separar caixas e plástico bolha para o estoque",
      date: daysFromToday(0),
      done: false,
      notes: "Tarefa interna, sem cliente vinculado.",
      clientId: null,
    },
  });
  await prisma.task.create({
    data: {
      userId: owner.id,
      title: "Enviar orçamento revisado",
      date: daysFromToday(-2),
      done: false,
      notes: "Atrasada - cliente pediu revisão de valores.",
      clientId: client3.id,
    },
  });
  await prisma.task.create({
    data: {
      userId: owner.id,
      title: "Confirmar endereço de destino",
      date: daysFromToday(-1),
      done: true,
      clientId: client4.id,
    },
  });
  await prisma.task.create({
    data: {
      userId: owner.id,
      title: "Preparar contrato de mudança",
      date: daysFromToday(5),
      done: false,
      notes: "Enviar por e-mail antes da vistoria final.",
      clientId: client3.id,
    },
  });

  console.log("Compromissos e tarefas de teste criados com sucesso.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
