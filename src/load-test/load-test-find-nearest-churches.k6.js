import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

// ===============================
// 📊 Métricas customizadas
// ===============================
const rateLimitErrors = new Counter('rate_limit_errors')
const successRate = new Rate('success_rate')
const cacheHitTrend = new Trend('cache_hit_duration')
const coldPathTrend = new Trend('cold_path_duration')

// ===============================
// ⚙️ Configuração dos cenários
// ===============================
export const options = {
  scenarios: {
    // CENÁRIO 1: Teste de Cache (CEP fixo)
    cache_stability: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      exec: 'cacheTest',
    },

    // CENÁRIO 2: Teste de Rate Limit (CEPs reais e únicos)
    provider_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      startTime: '35s',
      stages: [
        { target: 6, duration: '30s' },  // Subida suave
        { target: 9, duration: '20s' },  // Próximo ao limite
        { target: 13, duration: '30s' }, // Estourando limite (espera-se 429/503)
        { target: 0, duration: '10s' },  // Resfriamento
      ],
      exec: 'rateLimitTest',
    },
  },

  thresholds: {
    'cache_hit_duration': ['p(95)<50'],
    'cold_path_duration': ['p(95)<5000'],
    // Aceitamos erros controlados (429/503), mas não erros de servidor (500)
    'http_req_failed{status:500}': ['rate==0'],
  },
}

// ===============================
// 🌍 Configurações gerais
// ===============================
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333'
const ENDPOINT = '/churches/nearest'

// ===============================
// 📦 Carregamento dos CEPs reais
// ===============================
let VALID_CEPS = []
try {
  // Tenta carregar o arquivo se existir
  VALID_CEPS = JSON.parse(open('./fixtures/valid_ceps.json'))
} catch (e) {
  // Fallback para testes rápidos
  VALID_CEPS = ['01001000', '20040002', '30140071', '40020000', '50010000', '70040010', '80020000']
}

if (!Array.isArray(VALID_CEPS) || VALID_CEPS.length === 0) {
  VALID_CEPS = ['01001000']
}

// ===============================
// 🎯 Utilitário: CEP aleatório real
// ===============================
function getRandomValidCep() {
  const index = Math.floor(Math.random() * VALID_CEPS.length)
  return VALID_CEPS[index]
}

// ===============================
// 🧪 CENÁRIO 1 — Cache Hit
// ===============================
export function cacheTest() {
  const cep = '01001-000'
  const res = http.get(`${BASE_URL}${ENDPOINT}?cep=${cep}`)

  const isSuccess = check(res, {
    'status is 200 (cache)': (r) => r.status === 200,
    // Validação estrita para o Cache Hit
    'cache payload is valid': (r) => {
        const body = r.json();
        return Array.isArray(body.churches) && body.totalFound === 10;
    },
  })

  if (isSuccess) {
    successRate.add(1)
    cacheHitTrend.add(res.timings.duration)
  } else {
    successRate.add(0)
  }

  sleep(0.5)
}

// ===============================
// 🚦 CENÁRIO 2 — Rate Limit / Cold Path
// ===============================
export function rateLimitTest() {
  const cep = getRandomValidCep()
  const res = http.get(`${BASE_URL}${ENDPOINT}?cep=${cep}`)

  // Métricas: Consideramos sucesso se a API respondeu 200 OU se defendeu (429/503)
  if (res.status === 429 || res.status === 503) {
    rateLimitErrors.add(1)
  } else if (res.status === 200) {
    successRate.add(1)
    coldPathTrend.add(res.timings.duration)
  } else if (res.status === 404 || res.status === 400) {
    // 404 é um fluxo válido de negócio (CEP não existe)
    successRate.add(1)
  }

  // Asserções
  check(res, {
    // Verifica se o status HTTP é um dos esperados
    'status handled correctly': (r) => 
      [200, 400, 404, 429, 503].includes(r.status),
    
    // Verifica conteúdo APENAS se for sucesso (200)
    // Se for 429/503, ignoramos essa checagem (retorna true)
    'valid churches array & totalFound=10 (if 200)': (r) => {
      if (r.status !== 200) return true
      
      const body = r.json()
      // AQUI: A validação que você pediu
      // Verifica se existe o array 'churches' E se 'totalFound' é exatamente 10
      return Array.isArray(body.churches) && body.totalFound === 10
    },
  })
}