import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMovingDate } from '../src/ai.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

test('resolve "amanhã" usando o timestamp histórico, não o relógio da execução', async () => {
  const mock = getMockOpenAi()
  mock.setHandler((body) => {
    assert.equal(body.response_format?.json_schema?.name, 'moving_date_signals')
    return JSON.stringify({
      weekdayName: null,
      period: null,
      relativeDays: 1,
      relativeWeeks: null,
      dayOfMonth: null,
      monthName: null,
      vague: false,
    })
  })

  const referenceDate = new Date('2020-12-31T15:00:00-03:00')
  const history = [{ direction: 'IN', text: 'amanhã à tarde', timestamp: referenceDate.getTime() }]

  try {
    assert.equal(await extractMovingDate(history, referenceDate), '2021-01-01')
  } finally {
    mock.resetHandler()
  }
})

test('resolve datas relativas e preserva datas explícitas com datas-base fixas', async () => {
  const mock = getMockOpenAi()
  const base = new Date('2024-12-30T15:00:00-03:00') // segunda-feira
  const cases = [
    {
      text: 'hoje',
      signals: { relativeDays: 0 },
      expected: '2024-12-30',
    },
    {
      text: 'amanhã',
      signals: { relativeDays: 1 },
      expected: '2024-12-31',
    },
    {
      text: 'depois de amanhã',
      signals: { relativeDays: 2 },
      expected: '2025-01-01',
    },
    {
      text: 'sexta',
      signals: { weekdayName: 'sexta-feira' },
      expected: '2025-01-03',
    },
    {
      text: 'próxima sexta',
      signals: { weekdayName: 'sexta-feira', period: 'semana que vem' },
      expected: '2025-01-10',
    },
    {
      text: 'semana que vem',
      signals: { period: 'semana que vem', vague: true },
      expected: null,
    },
    {
      text: 'dia 15 de janeiro',
      referenceDate: new Date('2024-01-10T15:00:00-03:00'),
      signals: { dayOfMonth: 15, monthName: 'janeiro' },
      expected: '2024-01-15',
    },
    {
      text: 'amanhã na virada do mês',
      referenceDate: new Date('2024-01-31T15:00:00-03:00'),
      signals: { relativeDays: 1 },
      expected: '2024-02-01',
    },
  ]

  try {
    for (const entry of cases) {
      mock.setHandler(() => JSON.stringify({
        weekdayName: null,
        period: null,
        relativeDays: null,
        relativeWeeks: null,
        dayOfMonth: null,
        monthName: null,
        vague: false,
        ...entry.signals,
      }))
      const result = await extractMovingDate(
        [{ direction: 'IN', text: entry.text }],
        entry.referenceDate ?? base,
      )
      assert.equal(result, entry.expected, entry.text)
    }
  } finally {
    mock.resetHandler()
  }
})
