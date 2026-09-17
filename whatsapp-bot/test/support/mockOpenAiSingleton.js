// Compartilha a instância do mock do OpenAI (criada em test/support/setup.js,
// pré-carregado via `node --import`) com os arquivos de teste — mesmo
// módulo ESM, mesmo processo, então é a mesma instância em todo lugar.
export const mockOpenAiState = { instance: null }

export function getMockOpenAi() {
  if (!mockOpenAiState.instance) {
    throw new Error('Mock do OpenAI ainda não foi iniciado — rode os testes via `npm test` (usa test/support/setup.js como --import).')
  }
  return mockOpenAiState.instance
}
