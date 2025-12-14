const API_URL = 'http://localhost:3333/forms/submit-form'
const TOTAL_REQUESTS = 500
const CONCURRENCY = 50 // Envia em lotes de 50 para não travar sua máquina local

async function sendRequest(index: number) {
  const isDecision = index % 2 === 0 // Alterna entre decisão e contato

  const payload = {
    name: `LoadUser`,
    lastName: `Test ${index}`,
    email: `load.test.${index}@example.com`, // Email único para cada req
    decisaoPorCristo: isDecision,
    location: 'Sao Paulo, BR',
  }

  const start = Date.now()
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const duration = Date.now() - start

    if (response.ok) {
      // console.log(`✅ Req ${index} enviada em ${duration}ms`);
      return { status: 'ok', duration }
    } else {
      console.error(`❌ Req ${index} falhou: ${response.status}`)
      return { status: 'fail', duration }
    }
  } catch (err: unknown) {
    console.error(`❌ Req ${index} erro: ` + err)
    return { status: 'error', duration: Date.now() - start}
  }
}

async function runLoadTest() {
  console.log(`🚀 Iniciando teste de carga: ${TOTAL_REQUESTS} requisições...`)
  const startTime = Date.now()

  const results = []

  // Processa em lotes para controlar a concorrência do cliente
  for (let i = 0; i < TOTAL_REQUESTS; i += CONCURRENCY) {
    const batch = []
    for (let j = 0; j < CONCURRENCY && i + j < TOTAL_REQUESTS; j++) {
      batch.push(sendRequest(i + j))
    }
    const batchResults = await Promise.all(batch)
    results.push(...batchResults)
    process.stdout.write(`.`) // Barra de progresso visual
  }

  const endTime = Date.now()
  const totalTime = (endTime - startTime) / 1000

  const successes = results.filter((r) => r.status === 'ok').length
  const avgTime = results.reduce((acc, r) => acc + r.duration, 0) / results.length

  console.log('\n\n📊 Resultados do Teste:')
  console.log(`-----------------------------------`)
  console.log(`Total Enviado:    ${TOTAL_REQUESTS}`)
  console.log(`Sucessos (201):   ${successes}`)
  console.log(`Falhas:           ${TOTAL_REQUESTS - successes}`)
  console.log(`Tempo Total:      ${totalTime.toFixed(2)}s`)
  console.log(`Tempo Médio/Req:  ${avgTime.toFixed(2)}ms`) // Deve ser baixo (< 100ms)
  console.log(`Taxa (RPS):       ${(TOTAL_REQUESTS / totalTime).toFixed(2)} req/s`)
  console.log(`-----------------------------------`)
}

runLoadTest()