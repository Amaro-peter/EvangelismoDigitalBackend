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

// [ATUALIZADO] Lista completa de contadores
const countAwesomeApi = new Counter('provider_awesome_api') // <--- Faltava este
const countLocationIq = new Counter('provider_location_iq')
const countNominatim = new Counter('provider_nominatim')
const countOtherProvider = new Counter('provider_other')

export const options = {
  scenarios: {
    cache_stability: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      exec: 'cacheTest',
    },
    provider_stress: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 100,
      startTime: '35s',
      stages: [
        { target: 11, duration: '3m' },
        { target: 13, duration: '3m' },
        { target: 16, duration: '3m' },
        { target: 0, duration: '1m' },
      ],
      exec: 'rateLimitTest',
    },
  },
  thresholds: {
    'cache_hit_duration': ['p(95)<50'],
    'cold_path_duration': ['p(95)<5000'],
    'http_req_failed{status:500}': ['rate==0'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333'
const ENDPOINT = '/churches/nearest'

let VALID_CEPS = []
try {
  VALID_CEPS = JSON.parse(open('./fixtures/valid_ceps.json'))
} catch (e) {
  VALID_CEPS = ['01001000', '20040002', '30140071', '40020000', '50010000']
}

if (!Array.isArray(VALID_CEPS) || VALID_CEPS.length === 0) {
  VALID_CEPS = ['01001000']
}

function getRandomValidCep() {
  const index = Math.floor(Math.random() * VALID_CEPS.length)
  return VALID_CEPS[index]
}

// [ATUALIZADO] Função de rastreamento mais robusta
function trackProvider(res) {
  if (res.status !== 200) return

  try {
    const body = res.json()
    // Normaliza para lowercase para evitar erros de case (Ex: "AwesomeApiProvider" vs "AwesomeAPI")
    const providerRaw = body.providerName || ''
    const provider = typeof providerRaw === 'string' ? providerRaw.toLowerCase() : ''

    if (provider.includes('awesome')) {
      countAwesomeApi.add(1)
    } else if (provider.includes('location')) {
      countLocationIq.add(1)
    } else if (provider.includes('nominatim')) {
      countNominatim.add(1)
    } else {
      // Se cair aqui, é um nome novo que não mapeamos
      countOtherProvider.add(1)
      console.log(`Provider não reconhecido: ${providerRaw}`)
    }
  } catch (e) {
    // Ignora erro de parse
  }
}

export function cacheTest() {
  const cep = '01001-000'
  const res = http.get(`${BASE_URL}${ENDPOINT}?cep=${cep}`)

  check(res, {
    'status is 200 (cache)': (r) => r.status === 200,
    'cache payload is valid': (r) => {
        const body = r.json();
        return Array.isArray(body.churches) && body.totalFound === 10;
    },
  })

  if (res.status === 200) {
    successRate.add(1)
    cacheHitTrend.add(res.timings.duration)
    trackProvider(res)
  } else {
    successRate.add(0)
  }
  sleep(0.5)
}

export function rateLimitTest() {
  const cep = getRandomValidCep()
  const res = http.get(`${BASE_URL}${ENDPOINT}?cep=${cep}`)

  if (res.status === 429 || res.status === 503) {
    rateLimitErrors.add(1)
  } else if (res.status === 200) {
    successRate.add(1)
    coldPathTrend.add(res.timings.duration)
    trackProvider(res)
  } else if (res.status === 404 || res.status === 400) {
    successRate.add(1)
  }

  check(res, {
    'status handled correctly': (r) => 
      [200, 400, 404, 429, 503].includes(r.status),
    
    'valid churches array & totalFound=10 (if 200)': (r) => {
      if (r.status !== 200) return true
      const body = r.json()
      return Array.isArray(body.churches) && body.totalFound === 10
    },
  })
}