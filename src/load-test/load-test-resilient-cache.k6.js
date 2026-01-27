import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Counter } from 'k6/metrics'

export let options = {
  scenarios: {
    same_cep: {
      executor: 'constant-vus',
      exec: 'sameCep',
      vus: 100,
      duration: '10s',
    },
    different_ceps: {
      executor: 'per-vu-iterations',
      exec: 'differentCeps',
      vus: 50,
      iterations: 20,
      startTime: '10s',
    },
    negative_cache: {
      executor: 'per-vu-iterations',
      exec: 'negativeCache',
      vus: 10,
      iterations: 5,
      startTime: '20s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    errors: ['count<10'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333'
const CEP_ENDPOINT = '/churches/nearest'

let errors = new Counter('errors')

export function sameCep() {
  group('Same CEP - High Concurrency', function () {
    const cep = '01001-000'
    let res = http.get(`${BASE_URL}${CEP_ENDPOINT}?cep=${cep}`)
    check(res, {
      'status is 200': (r) => r.status === 200,
      'has lat/lon': (r) => r.json('userLat') !== undefined && r.json('userLon') !== undefined,
    }) || errors.add(1)
    sleep(Math.random() * 0.2)
  })
}

export function differentCeps() {
  group('Different CEPs', function () {
    const cep = `${Math.floor(Math.random() * 90000) + 10000}-000`
    let res = http.get(`${BASE_URL}${CEP_ENDPOINT}?cep=${cep}`)
    check(res, {
      'status is 200': (r) => r.status === 200,
    }) || errors.add(1)
    sleep(Math.random() * 0.2)
  })
}

export function negativeCache() {
  group('Negative Cache (invalid CEP)', function () {
    const cep = '00000-000'
    let res = http.get(`${BASE_URL}${CEP_ENDPOINT}?cep=${cep}`)
    check(res, {
      'status is 400 or 404': (r) => r.status === 400 || r.status === 404,
    }) || errors.add(1)
    sleep(Math.random() * 0.2)
  })
}