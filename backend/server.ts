import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAnyIncomingPayment, findIncomingPaymentByAmount, findIncomingPaymentBySenderAmount, isNanoAddress, nanoToRaw } from './nano-rpc'

const currencies = [
  'ARS',
  'BOB',
  'BRL',
  'CLP',
  'COP',
  'CRC',
  'CUP',
  'DOP',
  'EUR',
  'GTQ',
  'HNL',
  'HTG',
  'BTC',
  'ETH',
  'USDT',
  'USDC',
  'BNB',
  'SOL',
  'XRP',
  'ADA',
  'DOGE',
  'TRX',
  'MXN',
  'NIO',
  'PYG',
  'PEN',
  'USD',
  'UYU',
  'VES',
] as const

type Currency = (typeof currencies)[number]
type OfferStatus = 'ACTIVE' | 'NEGOTIATION' | 'RELEASING' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'

type SellerPaymentIntent = {
  id: string
  receiverAddress: string
  custodianId: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  clientIp: string
  clientSessionId?: string
  createdAt: string
  expiresAt: string
  paymentHash?: string
  senderWallet?: string
  amountXno?: string
}

type EscrowRecord = {
  id: string
  publishToken: string
  paymentIntentId: string
  paymentHash: string
  amountXno: string
  sellerWallet: string
  custodianId: string
  status: 'PENDING' | 'PUBLISHED'
  clientIp: string
  clientSessionId?: string
  createdAt: string
}

type OfferRecord = {
  id: string
  escrowId: string
  amountXno: string
  currency: Currency
  price: string
  sellerContact: string
  custodianId: string
  sellerCountry?: string
  sellerDialCode?: string
  sellerPrivateCode: string
  sellerWallet?: string
  paymentHash?: string
  buyerNanoAddress?: string
  buyerCountry?: string
  buyerDialCode?: string
  buyerContact?: string
  buyerSessionId?: string
  sellerSessionId?: string
  status: OfferStatus
  createdAt: string
  takenAt?: string
  releaseFeeIntentId?: string
  releaseFeeHash?: string
  releaseRequestedAt?: string
  custodianReleaseHash?: string
  closedAt?: string
  adminNote?: string
}

type UsedPayment = {
  hash: string
  purpose: 'seller_deposit' | 'release_fee' | 'custodian_release' | 'custodian_auth'
  createdAt: string
}

type CustodianAuthIntent = {
  id: string
  leaderCustodianId: string
  custodianId?: string
  receiverAddress: string
  amountXno: string
  paymentUri: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  createdAt: string
  expiresAt: string
  paymentHash?: string
}

type CustodianSession = {
  id: string
  custodianId: string
  createdAt: string
  expiresAt: string
}

type ReleaseFeeIntent = {
  id: string
  offerId: string
  senderWallet: string
  receiverAddress: string
  amountXno: string
  paymentUri: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  createdAt: string
  expiresAt: string
  paymentHash?: string
}

type Store = {
  custodians: Custodian[]
  sellerPaymentIntents: SellerPaymentIntent[]
  custodianAuthIntents: CustodianAuthIntent[]
  custodianSessions: CustodianSession[]
  releaseFeeIntents: ReleaseFeeIntent[]
  escrows: EscrowRecord[]
  offers: OfferRecord[]
  usedPayments: UsedPayment[]
}

const port = Number(process.env.NANOPAQUETE_API_PORT ?? 8789)
const adminUser = process.env.NANOPAQUETE_ADMIN_USER ?? 'admin'
const adminPassword = process.env.NANOPAQUETE_ADMIN_PASSWORD ?? 'nanopaquete'
type Custodian = {
  id: string
  name: string
  wallet: string
  contact: string
  country?: string
  dialCode?: string
  isLeader?: boolean
}

const defaultCustodians: Custodian[] = [
  {
    id: 'colombia-1',
    name: 'Nilson Islen Castrillon',
    wallet:
      process.env.NANOPAQUETE_ESCROW_WALLET ??
      'nano_1j7csyciamkzktswyxey5yt6f1rg1zbw3rtioe7xdze4fekkbo7zxri3ijxd',
    country: 'Colombia',
    dialCode: '+57',
    contact: process.env.NANOPAQUETE_CUSTODIAN_CONTACT ?? '+573008188284',
    isLeader: true,
  },
]

const getConfiguredCustodians = () => {
  const configured = process.env.NANOPAQUETE_CUSTODIANS_JSON?.trim()
  if (!configured) return defaultCustodians

  try {
    const parsed = JSON.parse(configured) as Custodian[]
    const valid = parsed.filter(
      (custodian) =>
        custodian.id &&
        custodian.name &&
        isNanoAddress(custodian.wallet) &&
        custodian.contact,
    )

    return valid.length ? valid : defaultCustodians
  } catch {
    return defaultCustodians
  }
}

const leaderCustodianId = defaultCustodians[0].id
const sanitizeCustodians = (value: unknown) => {
  const parsed = Array.isArray(value) ? (value as Custodian[]) : []
  const seen = new Set<string>()
  const valid = parsed.filter((custodian) => {
    const id = normalizeText(custodian.id)
    if (!id || seen.has(id)) return false
    if (!normalizeText(custodian.name) || !isNanoAddress(custodian.wallet) || !normalizeText(custodian.contact)) return false
    seen.add(id)
    return true
  })

  const normalized = valid.map((custodian) => ({
    ...custodian,
    isLeader: custodian.id === leaderCustodianId ? true : Boolean(custodian.isLeader),
  }))
  const hasDefaultLeader = normalized.some((custodian) => custodian.id === leaderCustodianId)
  const withDefaultLeader = hasDefaultLeader
    ? normalized
    : [...defaultCustodians, ...normalized.filter((custodian) => custodian.id !== leaderCustodianId)]

  return withDefaultLeader.some((custodian) => custodian.isLeader)
    ? withDefaultLeader
    : withDefaultLeader.map((custodian, index) => ({ ...custodian, isLeader: index === 0 }))
}
const getStoreCustodians = (store: Store) => sanitizeCustodians(store.custodians)
const getActiveCustodian = (store: Store) => getStoreCustodians(store)[0]
const getCustodianById = (store: Store, custodianId: string | undefined) =>
  getStoreCustodians(store).find((custodian) => custodian.id === custodianId) ?? getActiveCustodian(store)
const getCustodianByWallet = (store: Store, wallet: string) =>
  getStoreCustodians(store).find((custodian) => custodian.wallet === wallet)
const getLeaderCustodians = (store: Store) => getStoreCustodians(store).filter((custodian) => custodian.isLeader)
const isLeaderSession = (store: Store, session: CustodianSession | undefined) =>
  Boolean(session && getCustodianById(store, session.custodianId).isLeader)
const pickRandomLeaderCustodian = (store: Store) => {
  const leaders = getLeaderCustodians(store)
  return leaders[Math.floor(Math.random() * leaders.length)] ?? getActiveCustodian(store)
}
const custodyFeeXno = process.env.NANOPAQUETE_CUSTODY_FEE_XNO ?? '0.1'
const custodianAuthAmountXno = process.env.NANOPAQUETE_CUSTODIAN_AUTH_XNO ?? '0.01'
const sellerPaymentTtlMs = Number(process.env.NANOPAQUETE_SELLER_PAYMENT_TTL_MS ?? 60 * 60 * 1000)
const releaseFeeTtlMs = Number(process.env.NANOPAQUETE_RELEASE_FEE_TTL_MS ?? 60 * 60 * 1000)
const custodianAuthTtlMs = Number(process.env.NANOPAQUETE_CUSTODIAN_AUTH_TTL_MS ?? 15 * 60 * 1000)
const custodianSessionTtlMs = Number(process.env.NANOPAQUETE_CUSTODIAN_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000)
const takenOfferCustodianReleaseMs = Number(process.env.NANOPAQUETE_TAKEN_OFFER_RELEASE_MS ?? 24 * 60 * 60 * 1000)
const __dirname = dirname(fileURLToPath(import.meta.url))
const storePath = join(__dirname, 'data', 'nanopaquete.json')

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.NANOPAQUETE_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const sendJson = (response: ServerResponse, status: number, data: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders })
  response.end(JSON.stringify(data))
}

const sendHtml = (response: ServerResponse, status: number, html: string) => {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders })
  response.end(html)
}

const escapeHtml = (value: string | number | undefined) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const constantTimeEquals = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const isAdminAuthorized = (request: IncomingMessage) => {
  const authorization = request.headers.authorization ?? ''
  if (!authorization.startsWith('Basic ')) return false

  const credentials = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')
  const [user, ...passwordParts] = credentials.split(':')
  const password = passwordParts.join(':')

  return constantTimeEquals(user, adminUser) && constantTimeEquals(password, adminPassword)
}

const requestAdminAuth = (response: ServerResponse) => {
  response.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Nanopaquete"',
    ...corsHeaders,
  })
  response.end('Autenticacion requerida')
}

const readRequestText = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const readJsonBody = async (request: IncomingMessage) => {
  const bodyText = await readRequestText(request)
  if (!bodyText) return {}
  return JSON.parse(bodyText) as Record<string, unknown>
}

const readFormBody = async (request: IncomingMessage) => new URLSearchParams(await readRequestText(request))

const getClientIp = (request: IncomingMessage) => {
  const forwardedFor = request.headers['x-forwarded-for']
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  return forwardedIp?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown'
}

const readStore = async (): Promise<Store> => {
  try {
    const content = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(content) as Partial<Store>

    return {
      custodians: sanitizeCustodians(parsed.custodians ?? getConfiguredCustodians()),
      sellerPaymentIntents: Array.isArray(parsed.sellerPaymentIntents) ? parsed.sellerPaymentIntents : [],
      custodianAuthIntents: Array.isArray(parsed.custodianAuthIntents) ? parsed.custodianAuthIntents : [],
      custodianSessions: Array.isArray(parsed.custodianSessions) ? parsed.custodianSessions : [],
      releaseFeeIntents: Array.isArray(parsed.releaseFeeIntents) ? parsed.releaseFeeIntents : [],
      escrows: Array.isArray(parsed.escrows) ? parsed.escrows : [],
      offers: Array.isArray(parsed.offers) ? parsed.offers : [],
      usedPayments: Array.isArray(parsed.usedPayments) ? parsed.usedPayments : [],
    }
  } catch {
    return { custodians: sanitizeCustodians(getConfiguredCustodians()), sellerPaymentIntents: [], custodianAuthIntents: [], custodianSessions: [], releaseFeeIntents: [], escrows: [], offers: [], usedPayments: [] }
  }
}

const writeStore = async (store: Store) => {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify({ ...store, custodians: sanitizeCustodians(store.custodians) }, null, 2)}\n`)
}

const normalizeText = (value: unknown) => String(value ?? '').trim()
const normalizeClientSessionId = (value: unknown) =>
  normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
const createCustodianId = (name: string) => {
  const base = normalizeText(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'custodio'

  return `${base}-${randomBytes(3).toString('hex')}`
}
const isCurrency = (value: string): value is Currency => currencies.includes(value as Currency)

const createCode = (digits: number) => {
  const min = 10 ** (digits - 1)
  const range = 9 * min
  return String(min + (randomBytes(4).readUInt32BE(0) % range))
}

const createNanoPaymentUri = (receiver: string, amountXno?: string) =>
  amountXno ? `nano:${receiver}?amount=${nanoToRaw(amountXno)}` : `nano:${receiver}`

const getValidCustodianSession = (store: Store, sessionId: string) => {
  const normalized = normalizeClientSessionId(sessionId)
  if (!normalized) return undefined
  const now = Date.now()
  store.custodianSessions = store.custodianSessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  return store.custodianSessions.find((session) => session.id === normalized)
}

const canCustodianReleaseTakenOffer = (offer: OfferRecord) =>
  offer.status === 'NEGOTIATION' &&
  Boolean(offer.takenAt) &&
  Date.now() - new Date(offer.takenAt || '').getTime() >= takenOfferCustodianReleaseMs

const releaseTakenOffer = (offer: OfferRecord) => {
  offer.status = 'ACTIVE'
  offer.buyerNanoAddress = undefined
  offer.buyerCountry = undefined
  offer.buyerDialCode = undefined
  offer.buyerContact = undefined
  offer.buyerSessionId = undefined
  offer.takenAt = undefined
  offer.releaseFeeIntentId = undefined
}


const publicOffer = (offer: OfferRecord, context: { clientSessionId?: string; custodianSession?: CustodianSession } = {}) => {
  const isSeller = Boolean(context.clientSessionId && offer.sellerSessionId && offer.sellerSessionId === context.clientSessionId)
  const isCustodian = Boolean(context.custodianSession && context.custodianSession.custodianId === offer.custodianId)

  return {
    id: offer.id,
    amountXno: offer.amountXno,
    currency: offer.currency,
    price: offer.price,
    status: offer.status,
    createdAt: offer.createdAt,
    isOwnOffer: isSeller,
    canEditPrice: isSeller && offer.status === 'ACTIVE',
    canConfirmPayment: isSeller && offer.status === 'NEGOTIATION',
    canCustodianReleaseOffer: isCustodian && canCustodianReleaseTakenOffer(offer),
    ...(isSeller && offer.status === 'NEGOTIATION' && offer.buyerContact
      ? {
          buyerCountry: offer.buyerCountry,
          buyerDialCode: offer.buyerDialCode,
          buyerContact: offer.buyerContact,
        }
      : {}),
    ...(isCustodian && offer.status === 'NEGOTIATION'
      ? {
          sellerCountry: offer.sellerCountry,
          sellerDialCode: offer.sellerDialCode,
          sellerContact: offer.sellerContact,
          buyerCountry: offer.buyerCountry,
          buyerDialCode: offer.buyerDialCode,
          buyerContact: offer.buyerContact,
        }
      : {}),
    ...(isCustodian && offer.status === 'RELEASING' && offer.buyerNanoAddress
      ? {
          custodianReleaseUri: createNanoPaymentUri(offer.buyerNanoAddress, offer.amountXno),
        }
      : {}),
  }
}

const takenOfferResponse = (store: Store, offer: OfferRecord) => ({
  offer: publicOffer(offer),
  sellerContact: offer.sellerContact,
  sellerCountry: offer.sellerCountry,
  sellerDialCode: offer.sellerDialCode,
  custodianContact: getCustodianById(store, offer.custodianId).contact,
})

const escrowSessionResponse = (store: Store, escrow: EscrowRecord) => {
  const custodian = getCustodianById(store, escrow.custodianId)

  return {
  escrowId: escrow.id,
  publishToken: escrow.publishToken,
  amountXno: escrow.amountXno,
  sellerWallet: escrow.sellerWallet,
  paymentHash: escrow.paymentHash,
  custodianId: custodian.id,
  custodianName: custodian.name,
  custodianContact: custodian.contact,
  escrowWallet: custodian.wallet,
  custodyFeeXno,
}
}

const findRecoverableEscrow = (store: Store, clientSessionId: string) =>
  clientSessionId
    ? store.escrows.find(
        (escrow) => escrow.status === 'PENDING' && escrow.clientSessionId === clientSessionId,
      )
    : undefined

const statusLabel = (status: OfferStatus) =>
  ({
    ACTIVE: 'Activa',
    NEGOTIATION: 'En negociacion',
    RELEASING: 'Liberando',
    RELEASED: 'Liberada',
    CANCELLED: 'Cancelada',
    DISPUTED: 'En disputa',
  })[status]

const renderAdmin = (offers: OfferRecord[]) => `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nanopaquete Admin</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f5f7f4; color: #172019; }
      header { padding: 24px 32px; background: #18241c; color: white; }
      main { padding: 24px 32px; display: grid; gap: 18px; }
      article { background: white; border: 1px solid #d8ded6; border-radius: 8px; padding: 18px; }
      dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; margin: 0 0 16px; }
      dt { color: #657064; }
      dd { margin: 0; overflow-wrap: anywhere; }
      form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      select, input, button { min-height: 38px; border-radius: 6px; border: 1px solid #bfc9bd; padding: 0 10px; }
      button { background: #206b3a; color: white; border-color: #206b3a; cursor: pointer; }
      .status { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: #e7efe5; font-weight: 700; }
    </style>
  </head>
  <body>
    <header>
      <h1>Nanopaquete Admin</h1>
      <p>Panel manual de custodia, disputas y cierre de operaciones.</p>
    </header>
    <main>
      ${offers
        .map(
          (offer) => `<article>
            <h2>${escapeHtml(offer.amountXno)} XNO - ${escapeHtml(offer.price)} ${escapeHtml(offer.currency)}</h2>
            <dl>
              <dt>Estado</dt><dd><span class="status">${statusLabel(offer.status)}</span></dd>
              <dt>ID oferta</dt><dd>${escapeHtml(offer.id)}</dd>
              <dt>ID custodia</dt><dd>${escapeHtml(offer.escrowId)}</dd>
              <dt>Pais vendedor</dt><dd>${escapeHtml(offer.sellerCountry)}</dd>
              <dt>Extension contacto</dt><dd>${escapeHtml(offer.sellerDialCode)}</dd>
              <dt>Contacto vendedor</dt><dd>${escapeHtml(offer.sellerContact)}</dd>
              <dt>Codigo vendedor</dt><dd>${escapeHtml(offer.sellerPrivateCode)}</dd>
              <dt>Wallet vendedor</dt><dd>${escapeHtml(offer.sellerWallet)}</dd>
              <dt>Hash deposito</dt><dd>${escapeHtml(offer.paymentHash)}</dd>
              <dt>Wallet comprador</dt><dd>${escapeHtml(offer.buyerNanoAddress)}</dd>
              <dt>Pais comprador</dt><dd>${escapeHtml(offer.buyerCountry)}</dd>
              <dt>Extension comprador</dt><dd>${escapeHtml(offer.buyerDialCode)}</dd>
              <dt>Contacto comprador</dt><dd>${escapeHtml(offer.buyerContact)}</dd>
              <dt>Sesion vendedor</dt><dd>${escapeHtml(offer.sellerSessionId)}</dd>
              <dt>Sesion comprador</dt><dd>${escapeHtml(offer.buyerSessionId)}</dd>
              <dt>Hash comision liberacion</dt><dd>${escapeHtml(offer.releaseFeeHash)}</dd>
              <dt>Creada</dt><dd>${escapeHtml(offer.createdAt)}</dd>
              <dt>Tomada</dt><dd>${escapeHtml(offer.takenAt)}</dd>
              <dt>Solicito liberacion</dt><dd>${escapeHtml(offer.releaseRequestedAt)}</dd>
              <dt>Hash liberacion custodia</dt><dd>${escapeHtml(offer.custodianReleaseHash)}</dd>
              <dt>Nota admin</dt><dd>${escapeHtml(offer.adminNote)}</dd>
            </dl>
            <form method="post" action="/admin/offers/${encodeURIComponent(offer.id)}/status">
              <select name="status">
                ${(['ACTIVE', 'NEGOTIATION', 'RELEASING', 'DISPUTED', 'CANCELLED', 'RELEASED'] as OfferStatus[])
                  .map((status) => `<option value="${status}" ${status === offer.status ? 'selected' : ''}>${statusLabel(status)}</option>`)
                  .join('')}
              </select>
              <input name="adminNote" placeholder="Nota interna" value="${escapeHtml(offer.adminNote)}" />
              <button>Actualizar</button>
            </form>
          </article>`,
        )
        .join('') || '<article>No hay ofertas registradas.</article>'}
    </main>
  </body>
</html>`

const handleApi = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'nanopaquete' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/offers') {
    const clientSessionId = normalizeClientSessionId(url.searchParams.get('clientSessionId'))
    const custodianSessionId = normalizeClientSessionId(url.searchParams.get('custodianSessionId'))
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)
    if (custodianSessionId) await writeStore(store)
    sendJson(response, 200, {
      offers: store.offers
        .filter((offer) => ['ACTIVE', 'NEGOTIATION', 'RELEASING'].includes(offer.status))
        .filter((offer) => !custodianSession || offer.custodianId === custodianSession.custodianId)
        .map((offer) => publicOffer(offer, { clientSessionId, custodianSession })),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/custodians') {
    const store = await readStore()
    sendJson(response, 200, {
      custodians: getStoreCustodians(store).map((custodian) => ({
        id: custodian.id,
        name: custodian.name,
        contact: custodian.contact,
        country: custodian.country,
        dialCode: custodian.dialCode,
        wallet: custodian.wallet,
        isLeader: custodian.isLeader,
      })),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/custodian-admin/custodians') {
    const custodianSessionId = normalizeClientSessionId(url.searchParams.get('custodianSessionId'))
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)

    if (!custodianSession) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Autenticacion de custodio preautorizado requerida.' })
      return
    }

    await writeStore(store)
    sendJson(response, 200, { custodians: getStoreCustodians(store), canManage: isLeaderSession(store, custodianSession) })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/custodian-admin/custodians') {
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const name = normalizeText(body.name)
    const wallet = normalizeText(body.wallet)
    const country = normalizeText(body.country)
    const dialCode = normalizeText(body.dialCode)
    const contact = normalizeText(body.contact)
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)

    if (!isLeaderSession(store, custodianSession)) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Solo el custodio lider puede agregar custodios.' })
      return
    }

    if (!name || !country || !dialCode || !contact || !isNanoAddress(wallet)) {
      await writeStore(store)
      sendJson(response, 400, { error: 'Ingresa nombre, wallet Nano valida, pais y contacto del custodio.' })
      return
    }

    const existingCustodians = getStoreCustodians(store)
    if (existingCustodians.some((custodian) => custodian.wallet === wallet)) {
      await writeStore(store)
      sendJson(response, 409, { error: 'Ya existe un custodio con esa wallet.' })
      return
    }

    if (existingCustodians.some((custodian) => custodian.contact === contact)) {
      await writeStore(store)
      sendJson(response, 409, { error: 'Ya existe un custodio con ese contacto.' })
      return
    }

    const custodian: Custodian = {
      id: createCustodianId(name),
      name,
      wallet,
      country,
      dialCode,
      contact,
      isLeader: Boolean(body.isLeader),
    }
    store.custodians = [...existingCustodians, custodian]
    await writeStore(store)

    sendJson(response, 201, { custodian, custodians: getStoreCustodians(store) })
    return
  }

  const deleteCustodianMatch = url.pathname.match(/^\/api\/custodian-admin\/custodians\/([^/]+)$/)

  if (request.method === 'DELETE' && deleteCustodianMatch) {
    const custodianId = decodeURIComponent(deleteCustodianMatch[1])
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)

    if (!isLeaderSession(store, custodianSession)) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Solo el custodio lider puede eliminar custodios.' })
      return
    }

    const existingCustodians = getStoreCustodians(store)
    const custodian = existingCustodians.find((item) => item.id === custodianId)

    if (!custodian) {
      await writeStore(store)
      sendJson(response, 404, { error: 'Custodio no encontrado.' })
      return
    }

    if (custodian.isLeader && getLeaderCustodians(store).length <= 1) {
      await writeStore(store)
      sendJson(response, 409, { error: 'Debe quedar al menos un custodio lider.' })
      return
    }

    const hasLinkedRecords =
      store.offers.some((offer) => offer.custodianId === custodianId) ||
      store.escrows.some((escrow) => escrow.custodianId === custodianId) ||
      store.sellerPaymentIntents.some((intent) => intent.custodianId === custodianId)

    if (hasLinkedRecords) {
      await writeStore(store)
      sendJson(response, 409, { error: 'No se puede eliminar un custodio con ofertas, custodias o depositos asociados.' })
      return
    }

    store.custodians = existingCustodians.filter((item) => item.id !== custodianId)
    store.custodianSessions = store.custodianSessions.filter((session) => session.custodianId !== custodianId)
    store.custodianAuthIntents = store.custodianAuthIntents.filter(
      (intent) => intent.leaderCustodianId !== custodianId && intent.custodianId !== custodianId,
    )
    await writeStore(store)

    sendJson(response, 200, { custodians: getStoreCustodians(store) })
    return
  }

  const updateCustodianMatch = url.pathname.match(/^\/api\/custodian-admin\/custodians\/([^/]+)$/)

  if (request.method === 'PATCH' && updateCustodianMatch) {
    const custodianId = decodeURIComponent(updateCustodianMatch[1])
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const isLeader = Boolean(body.isLeader)
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)

    if (!isLeaderSession(store, custodianSession)) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Solo un custodio lider puede cambiar lideres.' })
      return
    }

    const existingCustodians = getStoreCustodians(store)
    const custodian = existingCustodians.find((item) => item.id === custodianId)

    if (!custodian) {
      await writeStore(store)
      sendJson(response, 404, { error: 'Custodio no encontrado.' })
      return
    }

    if (!isLeader && custodian.isLeader && existingCustodians.filter((item) => item.isLeader).length <= 1) {
      await writeStore(store)
      sendJson(response, 409, { error: 'Debe quedar al menos un custodio lider.' })
      return
    }

    store.custodians = existingCustodians.map((item) =>
      item.id === custodianId ? { ...item, isLeader } : item,
    )
    await writeStore(store)

    sendJson(response, 200, { custodians: getStoreCustodians(store) })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/buyer-negotiation') {
    const clientSessionId = normalizeClientSessionId(url.searchParams.get('clientSessionId'))
    const store = await readStore()
    const offer = store.offers.find(
      (item) =>
        ['NEGOTIATION', 'RELEASING'].includes(item.status) && item.buyerSessionId === clientSessionId,
    )

    sendJson(response, 200, { negotiation: offer ? takenOfferResponse(store, offer) : null })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/custodian-auth') {
    const store = await readStore()
    const now = Date.now()
    store.custodianAuthIntents = store.custodianAuthIntents.filter(
      (intent) => intent.status !== 'PENDING' || new Date(intent.expiresAt).getTime() > now,
    )
    const leader = pickRandomLeaderCustodian(store)

    const intent: CustodianAuthIntent = {
      id: `cua_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      leaderCustodianId: leader.id,
      receiverAddress: leader.wallet,
      amountXno: custodianAuthAmountXno,
      paymentUri: createNanoPaymentUri(leader.wallet, custodianAuthAmountXno),
      status: 'PENDING',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + custodianAuthTtlMs).toISOString(),
    }

    store.custodianAuthIntents.push(intent)
    await writeStore(store)
    sendJson(response, 201, intent)
    return
  }

  const verifyCustodianAuthMatch = url.pathname.match(/^\/api\/custodian-auth\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyCustodianAuthMatch) {
    const intentId = decodeURIComponent(verifyCustodianAuthMatch[1])
    const store = await readStore()
    const intent = store.custodianAuthIntents.find((item) => item.id === intentId)

    if (!intent) {
      sendJson(response, 404, { error: 'Autenticacion de custodio no encontrada.' })
      return
    }

    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      intent.status = 'EXPIRED'
      await writeStore(store)
      sendJson(response, 410, { error: 'La autenticacion vencio. Inicia una nueva.' })
      return
    }

    const assignedLeader = getStoreCustodians(store).find((custodian) => custodian.id === intent.leaderCustodianId)
    if (!assignedLeader?.isLeader) {
      intent.status = 'EXPIRED'
      await writeStore(store)
      sendJson(response, 410, { error: 'La autenticacion vencio porque el lider asignado ya no esta disponible. Inicia una nueva.' })
      return
    }

    try {
      const payment = await findIncomingPaymentByAmount({
        receiverWallet: intent.receiverAddress,
        amountNano: intent.amountXno,
        createdAfter: intent.createdAt,
        excludedHashes: store.usedPayments.map((item) => item.hash),
      })

      const authenticatedCustodian = getCustodianByWallet(store, payment.senderWallet)

      if (!authenticatedCustodian) {
        sendJson(response, 403, { error: 'Esta wallet no esta autorizada como custodio.' })
        return
      }

      const session: CustodianSession = {
        id: `cus_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
        custodianId: authenticatedCustodian.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + custodianSessionTtlMs).toISOString(),
      }

      intent.status = 'VERIFIED'
      intent.paymentHash = payment.hash
      store.custodianSessions.push(session)
      store.usedPayments.push({ hash: payment.hash, purpose: 'custodian_auth', createdAt: new Date().toISOString() })
      await writeStore(store)
      sendJson(response, 200, { sessionId: session.id, expiresAt: session.expiresAt, custodianId: authenticatedCustodian.id, custodianName: authenticatedCustodian.name, isLeader: isLeaderSession(store, session) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo autenticar al custodio.'
      sendJson(response, 422, {
        error: message.replace('wallet vendedora', 'wallet de custodia preautorizada'),
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/seller-payments') {
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const amountXno = normalizeText(body.amountXno).replace(',', '.')

    try {
      if (BigInt(nanoToRaw(amountXno)) <= 0n) {
        throw new Error('Monto invalido')
      }
    } catch {
      sendJson(response, 400, { error: 'Ingresa la cantidad de XNO que vas a vender.' })
      return
    }

    const store = await readStore()
    const custodian = getCustodianById(store, normalizeText(body.custodianId))
    const now = Date.now()
    store.sellerPaymentIntents = store.sellerPaymentIntents.filter(
      (intent) => intent.status !== 'PENDING' || new Date(intent.expiresAt).getTime() > now,
    )
    const intent: SellerPaymentIntent = {
      id: `pay_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      receiverAddress: custodian.wallet,
      custodianId: custodian.id,
      status: 'PENDING',
      clientIp: getClientIp(request),
      clientSessionId: clientSessionId || undefined,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + sellerPaymentTtlMs).toISOString(),
      amountXno,
    }
    store.sellerPaymentIntents.push(intent)
    await writeStore(store)

    sendJson(response, 201, {
      intentId: intent.id,
      receiverAddress: intent.receiverAddress,
      amountXno: intent.amountXno,
      paymentUri: createNanoPaymentUri(intent.receiverAddress, intent.amountXno),
      expiresAt: intent.expiresAt,
      custodianId: custodian.id,
      custodianName: custodian.name,
      custodianContact: custodian.contact,
    })
    return
  }

  const verifyPaymentMatch = url.pathname.match(/^\/api\/seller-payments\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyPaymentMatch) {
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const intentId = decodeURIComponent(verifyPaymentMatch[1])
    const store = await readStore()
    const intent = store.sellerPaymentIntents.find((item) => item.id === intentId)

    if (!intent) {
      sendJson(response, 404, { error: 'Solicitud de deposito no encontrada.' })
      return
    }

    if (intent.clientSessionId && intent.clientSessionId !== clientSessionId) {
      sendJson(response, 403, { error: 'Esta solicitud de deposito pertenece a otra sesion local.' })
      return
    }

    if (intent.status === 'VERIFIED') {
      const escrow = store.escrows.find((item) => item.paymentIntentId === intent.id)
      if (!escrow) {
        sendJson(response, 409, { error: 'El pago fue verificado, pero falta la custodia asociada.' })
        return
      }
      sendJson(response, 200, escrowSessionResponse(store, escrow))
      return
    }

    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      intent.status = 'EXPIRED'
      await writeStore(store)
      sendJson(response, 410, { error: 'La solicitud de deposito vencio. Inicia una nueva.' })
      return
    }

    try {
      const payment = intent.amountXno
        ? await findIncomingPaymentByAmount({
            receiverWallet: intent.receiverAddress,
            amountNano: intent.amountXno,
            createdAfter: intent.createdAt,
            excludedHashes: store.usedPayments.map((item) => item.hash),
          })
        : await findAnyIncomingPayment({
            receiverWallet: intent.receiverAddress,
            createdAfter: intent.createdAt,
            excludedHashes: store.usedPayments.map((item) => item.hash),
          })

      if (store.usedPayments.some((item) => item.hash === payment.hash)) {
        sendJson(response, 409, { error: 'Este deposito ya fue utilizado.' })
        return
      }

      const escrow: EscrowRecord = {
        id: `esc_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
        publishToken: randomUUID().replaceAll('-', ''),
        paymentIntentId: intent.id,
        paymentHash: payment.hash,
        amountXno: payment.amountNano,
        sellerWallet: payment.senderWallet,
        custodianId: intent.custodianId,
        status: 'PENDING',
        clientIp: intent.clientIp,
        clientSessionId: intent.clientSessionId,
        createdAt: new Date().toISOString(),
      }

      intent.status = 'VERIFIED'
      intent.paymentHash = payment.hash
      intent.senderWallet = payment.senderWallet
      intent.amountXno = payment.amountNano
      store.escrows.unshift(escrow)
      store.usedPayments.push({ hash: payment.hash, purpose: 'seller_deposit', createdAt: new Date().toISOString() })
      await writeStore(store)

      sendJson(response, 200, escrowSessionResponse(store, escrow))
    } catch (error) {
      const recoverableEscrow = findRecoverableEscrow(store, clientSessionId)

      if (recoverableEscrow) {
        sendJson(response, 200, escrowSessionResponse(store, recoverableEscrow))
        return
      }

      sendJson(response, 422, { error: error instanceof Error ? error.message : 'No se pudo validar el deposito.' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/offers') {
    const body = await readJsonBody(request)
    const escrowId = normalizeText(body.escrowId)
    const publishToken = normalizeText(body.publishToken)
    const currency = normalizeText(body.currency).toUpperCase()
    const price = normalizeText(body.price)
    const sellerCountry = normalizeText(body.sellerCountry)
    const sellerDialCode = normalizeText(body.sellerDialCode)
    const sellerContact = normalizeText(body.sellerContact)

    if (!isCurrency(currency)) {
      sendJson(response, 400, { error: 'Selecciona un activo valido.' })
      return
    }

    if (!price) {
      sendJson(response, 400, { error: 'Ingresa el precio esperado.' })
      return
    }

    if (!sellerCountry || !sellerDialCode) {
      sendJson(response, 400, { error: 'Ingresa pais y extension del contacto del vendedor.' })
      return
    }

    if (sellerContact.length < 6) {
      sendJson(response, 400, { error: 'Ingresa un contacto valido para la negociacion.' })
      return
    }

    const store = await readStore()
    const escrow = store.escrows.find((item) => item.id === escrowId && item.publishToken === publishToken)

    if (!escrow) {
      sendJson(response, 404, { error: 'No se encontro la custodia verificada.' })
      return
    }

    if (escrow.status !== 'PENDING') {
      sendJson(response, 409, { error: 'Esta custodia ya fue publicada.' })
      return
    }

    const offer: OfferRecord = {
      id: `of_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      escrowId: escrow.id,
      amountXno: escrow.amountXno,
      currency,
      price,
      sellerCountry,
      sellerDialCode,
      sellerContact,
      sellerPrivateCode: createCode(8),
      sellerWallet: escrow.sellerWallet,
      custodianId: escrow.custodianId,
      sellerSessionId: escrow.clientSessionId,
      paymentHash: escrow.paymentHash,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    }

    escrow.status = 'PUBLISHED'
    store.offers.unshift(offer)
    await writeStore(store)

    {
      const custodian = getCustodianById(store, offer.custodianId)
      sendJson(response, 201, { offer: publicOffer(offer), sellerPrivateCode: offer.sellerPrivateCode, custodianContact: custodian.contact, custodyFeeXno })
    }
    return
  }

  const priceMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/price$/)

  if (request.method === 'POST' && priceMatch) {
    const offerId = decodeURIComponent(priceMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const price = normalizeText(body.price)

    if (!price) {
      sendJson(response, 400, { error: 'Ingresa el nuevo precio.' })
      return
    }

    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (!offer.sellerSessionId || offer.sellerSessionId !== clientSessionId) {
      sendJson(response, 403, { error: 'Solo la sesion vendedora puede editar el precio.' })
      return
    }

    if (offer.status !== 'ACTIVE') {
      sendJson(response, 409, { error: 'Esta oferta ya no permite editar el precio.' })
      return
    }

    offer.price = price
    await writeStore(store)
    sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }) })
    return
  }

  const takeMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/take$/)

  if (request.method === 'POST' && takeMatch) {
    const offerId = decodeURIComponent(takeMatch[1])
    const body = await readJsonBody(request)
    const buyerNanoAddress = normalizeText(body.buyerNanoAddress)
    const buyerCountry = normalizeText(body.buyerCountry)
    const buyerDialCode = normalizeText(body.buyerDialCode)
    const buyerContact = normalizeText(body.buyerContact)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)

    if (!isNanoAddress(buyerNanoAddress)) {
      sendJson(response, 400, { error: 'Ingresa una cuenta nano valida para recibir los XNO.' })
      return
    }

    if (!buyerCountry || !buyerDialCode || buyerContact.length < 6) {
      sendJson(response, 400, { error: 'Ingresa pais, extension y contacto valido del comprador.' })
      return
    }

    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.status !== 'ACTIVE') {
      sendJson(response, 409, { error: 'Esta oferta ya no esta disponible.' })
      return
    }

    if (offer.sellerSessionId && offer.sellerSessionId === clientSessionId) {
      sendJson(response, 403, { error: 'No puedes tomar una oferta que publicaste desde esta sesion.' })
      return
    }

    const currentNegotiation = store.offers.find(
      (item) =>
        ['NEGOTIATION', 'RELEASING'].includes(item.status) && item.buyerSessionId === clientSessionId,
    )

    if (currentNegotiation) {
      sendJson(response, 409, { error: 'Ya tienes una negociacion abierta. Cancela o cierra esa negociacion antes de tomar otra oferta.' })
      return
    }

    offer.status = 'NEGOTIATION'
    offer.buyerNanoAddress = buyerNanoAddress
    offer.buyerCountry = buyerCountry
    offer.buyerDialCode = buyerDialCode
    offer.buyerContact = buyerContact
    offer.buyerSessionId = clientSessionId || undefined
    offer.takenAt = new Date().toISOString()
    await writeStore(store)

    sendJson(response, 200, takenOfferResponse(store, offer))
    return
  }

  const cancelTakeMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/cancel-take$/)

  if (request.method === 'POST' && cancelTakeMatch) {
    const offerId = decodeURIComponent(cancelTakeMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.status !== 'NEGOTIATION') {
      sendJson(response, 409, { error: 'Esta oferta no esta en negociacion.' })
      return
    }

    if (offer.buyerSessionId && offer.buyerSessionId !== clientSessionId) {
      sendJson(response, 403, { error: 'Solo la sesion que tomo la oferta puede cancelar este proceso.' })
      return
    }

    releaseTakenOffer(offer)
    await writeStore(store)

    sendJson(response, 200, { offer: publicOffer(offer) })
    return
  }

  const releaseExpiredTakeMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/release-expired-take$/)

  if (request.method === 'POST' && releaseExpiredTakeMatch) {
    const offerId = decodeURIComponent(releaseExpiredTakeMatch[1])
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const store = await readStore()

    const custodianSession = getValidCustodianSession(store, custodianSessionId)
    if (!custodianSession) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Autenticacion de custodio preautorizado requerida.' })
      return
    }

    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.custodianId !== custodianSession.custodianId) {
      sendJson(response, 403, { error: 'Esta oferta pertenece a otro custodio.' })
      return
    }

    if (offer.status !== 'NEGOTIATION') {
      sendJson(response, 409, { error: 'Esta oferta no esta en negociacion.' })
      return
    }

    if (!canCustodianReleaseTakenOffer(offer)) {
      sendJson(response, 409, { error: 'El custodio solo puede liberar la oferta despues de 24 horas sin cierre ni cancelacion.' })
      return
    }

    releaseTakenOffer(offer)
    await writeStore(store)

    sendJson(response, 200, { offer: publicOffer(offer, { custodianSession }) })
    return
  }

  const releaseIntentMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/release-intents$/)

  if (request.method === 'POST' && releaseIntentMatch) {
    const offerId = decodeURIComponent(releaseIntentMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.status !== 'NEGOTIATION') {
      sendJson(response, 409, { error: 'Solo se puede confirmar una oferta en negociacion.' })
      return
    }

    if (!offer.sellerSessionId || offer.sellerSessionId !== clientSessionId) {
      sendJson(response, 403, { error: 'Solo la sesion vendedora que publico la oferta puede confirmar el pago.' })
      return
    }

    if (!offer.sellerWallet) {
      sendJson(response, 409, { error: 'Esta oferta no tiene wallet vendedora asociada.' })
      return
    }

    const now = Date.now()
    store.releaseFeeIntents = store.releaseFeeIntents.filter(
      (intent) => intent.status !== 'PENDING' || new Date(intent.expiresAt).getTime() > now,
    )
    const existing = store.releaseFeeIntents.find(
      (intent) => intent.offerId === offer.id && intent.status === 'PENDING',
    )

    if (existing) {
      sendJson(response, 200, existing)
      return
    }

    const custodian = getCustodianById(store, offer.custodianId)
    const intent: ReleaseFeeIntent = {
      id: `rel_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      offerId: offer.id,
      senderWallet: offer.sellerWallet,
      receiverAddress: custodian.wallet,
      amountXno: custodyFeeXno,
      paymentUri: createNanoPaymentUri(custodian.wallet, custodyFeeXno),
      status: 'PENDING',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + releaseFeeTtlMs).toISOString(),
    }

    store.releaseFeeIntents.push(intent)
    offer.releaseFeeIntentId = intent.id
    await writeStore(store)
    sendJson(response, 201, intent)
    return
  }

  const verifyCustodianReleaseMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/verify-custodian-release$/)

  if (request.method === 'POST' && verifyCustodianReleaseMatch) {
    const offerId = decodeURIComponent(verifyCustodianReleaseMatch[1])
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const store = await readStore()

    const custodianSession = getValidCustodianSession(store, custodianSessionId)
    if (!custodianSession) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Autenticacion de custodio preautorizado requerida.' })
      return
    }
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.custodianId !== custodianSession.custodianId) {
      sendJson(response, 403, { error: 'Esta oferta pertenece a otro custodio.' })
      return
    }

    if (offer.status === 'RELEASED') {
      sendJson(response, 200, { offer: publicOffer(offer, { custodianSession }), paymentHash: offer.custodianReleaseHash })
      return
    }

    if (offer.status !== 'RELEASING') {
      sendJson(response, 409, { error: 'Solo se puede verificar una oferta en estado liberando.' })
      return
    }

    if (!offer.buyerNanoAddress) {
      sendJson(response, 409, { error: 'Esta oferta no tiene wallet compradora registrada.' })
      return
    }

    try {
      const payment = await findIncomingPaymentBySenderAmount({
        receiverWallet: offer.buyerNanoAddress,
        senderWallet: getCustodianById(store, offer.custodianId).wallet,
        amountNano: offer.amountXno,
        createdAfter: offer.releaseRequestedAt,
        excludedHashes: store.usedPayments.map((item) => item.hash),
      })

      offer.status = 'RELEASED'
      offer.custodianReleaseHash = payment.hash
      offer.closedAt = new Date().toISOString()
      store.usedPayments.push({ hash: payment.hash, purpose: 'custodian_release', createdAt: new Date().toISOString() })
      await writeStore(store)
      sendJson(response, 200, { offer: publicOffer(offer, { custodianSession }), paymentHash: payment.hash })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo validar la liberacion del custodio.'
      sendJson(response, 422, {
        error: message.replace('wallet vendedora', 'wallet de custodia'),
      })
    }
    return
  }

  const verifyReleaseIntentMatch = url.pathname.match(/^\/api\/release-intents\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyReleaseIntentMatch) {
    const intentId = decodeURIComponent(verifyReleaseIntentMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const store = await readStore()
    const intent = store.releaseFeeIntents.find((item) => item.id === intentId)

    if (!intent) {
      sendJson(response, 404, { error: 'Solicitud de liberacion no encontrada.' })
      return
    }

    const offer = store.offers.find((item) => item.id === intent.offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    if (offer.status === 'RELEASING') {
      sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), paymentHash: offer.releaseFeeHash })
      return
    }

    if (offer.status !== 'NEGOTIATION') {
      sendJson(response, 409, { error: 'Esta oferta ya no esta en negociacion.' })
      return
    }

    if (!offer.sellerSessionId || offer.sellerSessionId !== clientSessionId) {
      sendJson(response, 403, { error: 'Solo la sesion vendedora que publico la oferta puede confirmar el pago.' })
      return
    }

    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      intent.status = 'EXPIRED'
      await writeStore(store)
      sendJson(response, 410, { error: 'La solicitud de liberacion vencio. Inicia una nueva.' })
      return
    }

    try {
      const payment = await findIncomingPaymentBySenderAmount({
        receiverWallet: intent.receiverAddress,
        senderWallet: intent.senderWallet,
        amountNano: intent.amountXno,
        createdAfter: intent.createdAt,
        excludedHashes: store.usedPayments.map((item) => item.hash),
      })

      intent.status = 'VERIFIED'
      intent.paymentHash = payment.hash
      offer.status = 'RELEASING'
      offer.releaseFeeHash = payment.hash
      offer.releaseRequestedAt = new Date().toISOString()
      store.usedPayments.push({ hash: payment.hash, purpose: 'release_fee', createdAt: new Date().toISOString() })
      await writeStore(store)
      sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), paymentHash: payment.hash })
    } catch (error) {
      sendJson(response, 422, {
        error: error instanceof Error ? error.message : 'No se pudo validar la comision de liberacion.',
      })
    }
    return
  }

  sendJson(response, 404, { error: 'Ruta no encontrada.' })
}

const handleAdmin = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  if (!isAdminAuthorized(request)) {
    requestAdminAuth(response)
    return
  }

  if (request.method === 'GET' && url.pathname === '/admin/offers') {
    const store = await readStore()
    sendHtml(response, 200, renderAdmin(store.offers))
    return
  }

  const statusMatch = url.pathname.match(/^\/admin\/offers\/([^/]+)\/status$/)

  if (request.method === 'POST' && statusMatch) {
    const offerId = decodeURIComponent(statusMatch[1])
    const form = await readFormBody(request)
    const nextStatus = String(form.get('status') ?? '')
    const adminNote = String(form.get('adminNote') ?? '').trim()

    if (!(['ACTIVE', 'NEGOTIATION', 'DISPUTED', 'CANCELLED', 'RELEASED'] as string[]).includes(nextStatus)) {
      sendJson(response, 400, { error: 'Estado invalido.' })
      return
    }

    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'Oferta no encontrada.' })
      return
    }

    if (nextStatus === 'RELEASED' && offer.status !== 'RELEASING') {
      sendJson(response, 409, { error: 'Solo se puede liberar una oferta en estado liberando.' })
      return
    }

    offer.status = nextStatus as OfferStatus
    offer.adminNote = adminNote || undefined
    if (nextStatus === 'CANCELLED' || nextStatus === 'RELEASED') offer.closedAt = new Date().toISOString()

    await writeStore(store)
    response.writeHead(303, { Location: '/admin/offers', ...corsHeaders })
    response.end()
    return
  }

  sendJson(response, 404, { error: 'Ruta admin no encontrada.' })
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Solicitud invalida.' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }

    if (url.pathname.startsWith('/admin/')) {
      await handleAdmin(request, response, url)
      return
    }

    sendJson(response, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    const message = error instanceof SyntaxError ? 'El JSON enviado no es valido.' : 'Error interno del servidor.'
    sendJson(response, error instanceof SyntaxError ? 400 : 500, { error: message })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Nanopaquete API escuchando en http://0.0.0.0:${port}`)
})
