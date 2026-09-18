# Relatório final dos ajustes da bateria de IA

Data: 18/09/2026. Escopo: revisão do relatório de 17/09, correções no bot, CRM e ferramentas de avaliação. Alterações locais; sem publicação, reinício de serviços ou atualização do banco em uso.

## Resultado principal

A extração agora preserva informações conhecidas quando a IA devolve ausência de informação, normaliza escada/elevador, mantém apelido entre turnos e separa condições comerciais do orçamento autorizado. A bateria respeita o dataset selecionado, não desperdiça vagas com conversas vazias e não executa turnos extras por debounce durante o replay manual.

Os testes locais e a avaliação pontual com API real estão descritos abaixo. Não foi refeita a extração completa das 885 conversas nem demonstrada uma nova taxa de acurácia para toda a base.

## Alterações realizadas

### 1. Preservação de informações no CRM

- Novo `src/extractionPolicy.js`: respostas nulas, vazias ou “ainda não informado” não apagam endereços, tipo de imóvel, itens, apelido e condições comerciais previamente conhecidos.
- Nome já confirmado é mantido quando uma extração subsequente não retorna nome.
- Escada/elevador é normalizado para `Origem: ... Destino: ...`, inclusive quando nenhum lado está informado. Respostas parciais preservam cada lado conhecido separadamente.
- Texto de escada/elevador sem indicação de lado não é atribuído arbitrariamente à origem ou ao destino; o campo permanece pendente de esclarecimento.
- Acesso do caminhão preserva respostas anteriores, inclusive respostas legadas como “Sim, nos dois.”, se a nova extração só trouxer ausência de informação.
- Novos valores concretos continuam podendo corrigir valores anteriores.
- Data já registrada não é apagada por uma extração que retorna `null`.
- Vistoria resolvida e tipo conhecido são preservados; resultado sem tipo não fica marcado como resolvido.

Limite: a proteção evita perda por ausência, mas não prova que um valor antigo esteja correto. Exclusões ou cancelamentos que só resultem em `null` precisam de revisão pela equipe; não foi introduzido um protocolo de exclusão explícita com evidência. Datas relativas e correções conflitantes continuam dependendo da interpretação do histórico.

### 2. Condições comerciais e apelido

- Adicionados `Client.commercialNotes` e `Client.clientNickname`, ambos opcionais.
- `commercialNotes` recebe o resumo comercial extraído, com instrução para distinguir proposta, autor da proposta e aceite explícito.
- `budgetValue` e `budgetNotes` continuam sob controle do fluxo de orçamento/equipe. A extração não os altera nem autoriza envio de orçamento.
- O CRM exibe “Condições mencionadas na conversa” junto à seção de orçamento, mesmo quando não há valor aprovado.
- Valores declarados de bens para seguro continuam permitidos nos itens; não foram removidos por regex.
- Apelido passa a ser persistido e incluído no estado fornecido à próxima extração.

O relatório anterior estava incorreto ao afirmar genericamente que não havia campo de orçamento: `budgetValue` e `budgetNotes` já existiam. O novo campo separa informação extraída da conversa de informação autorizada pela equipe.

### 3. Tratamento de falhas da API

- A implementação já possuía retry em produção, ao contrário da recomendação do relatório.
- Centralizado o retry em `src/apiRetry.js`, com até três tentativas e esperas de 400/800 ms.
- Retry para falhas de conexão, timeout, 408, 409, 429 e 5xx.
- Erros permanentes, inclusive 400/401/403/404/422, falham sem repetição automática. Um 404 não é classificado como transitório sem diagnóstico.
- Desativado retry interno do SDK para não multiplicar tentativas.
- Removido retry exclusivo do proxy de testes: os testes reais passam pela mesma política da produção.
- Logs registram status, tentativa e identificador da requisição quando disponível, sem registrar chaves ou conteúdo da conversa nesses novos logs.

Não há diagnóstico conclusivo do 404 histórico. A nova avaliação real não reproduziu esse erro.

### 4. Correções nas baterias

- `loadConversations()` agora lê `BATTERY_EXPORT_DIR`; o código encontrado não implementava isso, embora o relatório afirmasse que implementava.
- Arquivos são ordenados para amostragem reprodutível.
- Baterias 3 e 4 filtram conversas vazias antes da seleção e distribuem amostras por tamanho, incluindo os extremos quando há mais de uma vaga.
- Tamanho solicitado e tamanho efetivo aparecem nos resultados.
- Comparação de determinismo distingue diferenças cosméticas de diferenças que precisam de revisão de conteúdo; ordem das chaves JSON não gera instabilidade artificial.
- Reuso do resultado antigo de `export/` na bateria combinada deixa de ser obrigatório: só ocorre com `BATTERY_REUSE_EXPORT=true`, identificado como histórico.
- Resultados reais novos incluem data, modelo, hash dos arquivos relevantes e ressalva sobre preenchimento versus acurácia.
- Replay manual injeta agendamento inativo: apenas o executor da bateria dispara cada turno. Em produção, o padrão permanece o debounce normal.
- Inicialização do SQLite temporário foi corrigida: cria o arquivo antes de chamar Prisma. Neste ambiente, a ausência do arquivo causava erro do schema engine.

A seleção por tamanho melhora a diversidade, mas não garante representar todos os tipos de ambiguidade. A avaliação de referência complementa essa seleção com casos dirigidos.

### 5. Avaliação com respostas de referência

Criado `runReferenceAccuracy.js`, com dois casos reais e dois sintéticos, anotados pelo agente a partir do texto. Não são anotações humanas independentes nem uma amostra estatística suficiente para medir acurácia global.

- Conversa real crítica: verifica ausência de nome/apelido declarados pelo cliente, acesso do caminhão não informado, tipo de imóvel e vistoria.
- Formulário real com uma mensagem: verifica nome, elementos dos endereços e itens, além de ausência de informação comercial e de acesso.
- Caso sintético comercial: verifica separação entre sofá e proposta de pagamento.
- Caso sintético de correção: verifica troca de endereço, apelido e restrição de acesso no destino.

Foi necessária autorização explícita após a revisão automática bloquear o envio das conversas à API. O usuário autorizou os quatro casos e a execução foi concluída.

Resultado: **4/4 casos aprovados nos critérios definidos**, com quatro extrações reais. Tokens: 10.404 de entrada e 543 de saída. Custo estimado pelas constantes do projeto: **US$ 0,0018864**; não é valor consultado em fatura.

A primeira avaliação marcou 3/4 porque o avaliador exigia a redação “Destino: não...” para acesso, enquanto o modelo respondeu corretamente “Só na origem.”, formato permitido pelo próprio contrato. O avaliador foi corrigido para aceitar essa alternativa e a mesma resposta foi reavaliada localmente, sem custo adicional. As duas avaliações foram preservadas.

## Validação local

- Suíte do bot: **21 testes aprovados, zero falhas**.
- Novas regressões: preservação e correção de campos; formato e preenchimento parcial por lado; retry e limite de tentativas; exclusão de conversas vazias; classificação cosmética; persistência de apelido/condições comerciais sem alterar orçamento; escolha do dataset por variável de ambiente.
- `npx tsc --noEmit`: aprovado.
- `npm run lint`: aprovado, sem avisos.
- `git diff --check`: aprovado.
- Prisma Client gerado com os novos campos; schema validado em SQLite temporário, sem tocar no banco em uso.
- Bateria estrutural final: resultados consolidados na tabela de execução ao fim deste documento.

## Correções de interpretação do relatório original

1. Preenchimento e flags heurísticas não equivalem a acurácia. Ausência de flags não prova fidelidade do conteúdo.
2. `temperature=0` reduz variação, mas não garante igualdade entre execuções. Reuso histórico não valida alterações posteriores no código.
3. Das 17 comparações antigas, duas tinham diferenças cosméticas e uma tinha diferença de conteúdo; essa amostra não estima com precisão o risco em produção.
4. Ao reler o caso crítico, o texto exportado não confirma acesso do caminhão. “Sim, nos dois” não tem suporte textual. “Leila” aparece nas falas da empresa, sem oferecimento de apelido pela cliente. Logo, o problema não era apenas perder um dado: havia possível invenção na primeira extração.
5. Das 30 conversas selecionadas no replay antigo, cinco não tinham mensagens; foram 25 com conteúdo, sendo dez de Marcia com uma mensagem.
6. O handoff foi validado nos cenários testados, com mock e agrupamento simplificado; não representa prova universal do timing de produção.
7. O custo histórico era uma estimativa por tokens. Não foi consultada a fatura.
8. A divergência entre o carregador encontrado e o relato sobre seleção de diretório exige cautela ao interpretar a execução histórica; as novas rodadas usam diretórios explicitamente configurados.

## Aplicação da versão

Foi preparada a atualização aditiva `prisma/updates/20260918-extraction-fields.sql`. Ela adiciona somente duas colunas opcionais e deve ser aplicada uma vez, antes de iniciar a versão nova no banco alvo. Não executar duas vezes: se as colunas já existirem, a transação falhará.

Com backup do banco e o ambiente alvo selecionado, a sequência de publicação é:

```sh
npx prisma db execute --schema prisma/schema.prisma --file prisma/updates/20260918-extraction-fields.sql
npx prisma generate
npm run build
```

O reinício dos serviços deve ocorrer depois dessa sequência. Nenhum deploy ou reinício foi executado nesta tarefa. O banco real não foi atualizado. Não iniciar o novo código sobre o schema antigo, pois as novas colunas são necessárias às consultas do Prisma.

## Evidências e limites finais

- Resultados estruturais finais: `out/adjustments/final/export/structural-battery-results.json` e `out/adjustments/final/marcia/structural-battery-results.json`.
- API real: `out/adjustments/reference-accuracy-first-evaluation.json` e `out/adjustments/reference-accuracy-results.json`.
- O relatório histórico foi preservado com uma nota de revisão apontando para este documento.
- Nenhuma mensagem real foi enviada pelo WhatsApp durante a validação.
- As proteções de código estão verificadas localmente; quatro exemplos reais/sintéticos não demonstram eliminação de alucinações, vazamentos comerciais ou instabilidade em toda a base.
- Ainda cabe ampliar a referência com revisão humana independente, validar cancelamentos explícitos e executar nova bateria real ampla para medir a taxa de erro após as mudanças. Nenhuma taxa global nova de acurácia é afirmada aqui.

## Consolidação da bateria estrutural final

| Métrica | export | Marcia | Total |
|---|---:|---:|---:|
| Conversas | 383 | 881 | 1264 |
| Mensagens | 12587 | 553 | 13140 |
| Handoffs detectados | 345 | 299 | 644 |
| Conversas com intervenção humana | 345 | 299 | 644 |
| Turnos humanos processados no CRM | 3117 | 302 | 3419 |
| Violações de silêncio | 0 | 0 | 0 |
| Crashes | 0 | 0 | 0 |
| Conversas com contagem divergente | 0 | 0 | 0 |

As duas rodadas finais usaram API mock, banco temporário, WhatsApp simulado e replay manual com agendamento controlado. Resultado: 644/644 handoffs detectados e 3.419/3.419 turnos humanos processados no CRM. Esses números validam comportamento estrutural, não qualidade semântica da IA.
