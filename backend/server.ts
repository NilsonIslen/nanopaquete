import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAnyIncomingPayment, isNanoAddress } from './nano-rpc'

const currencies = ['COP', 'USD', 'BTC', 'EUR'] as const

type Currency = (typeof currencies)[number]
type OfferStatus = 'ACTIVE' | 'NEGOTIATION' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'

type SellerPaymentIntent = {
  id: string
  receiverAddress: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  clientIp: string
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
  status: 'PENDING' | 'PUBLISHED'
  clientIp: string
  createdAt: string
}

type OfferRecord = {
  id: string
  escrowId: string
  amountXno: string
  currency: Currency
  price: string
  sellerContact: string
  sellerPrivateCode: string
  sellerWallet?: string
  paymentHash?: string
  buyerNanoAddress?: string
  buyerCancelCode?: string
  status: OfferStatus
  createdAt: string
  takenAt?: string
  closedAt?: string
  adminNote?: string
}

type UsedPayment = {
  hash: string
  purpose: 'seller_deposit'
  createdAt: string
}

type Store = {
  sellerPaymentIntents: SellerPaymentIntent[]
  escrows: EscrowRecord[]
  offers: OfferRecord[]
  usedPayments: UsedPayment[]
}

const port = Number(process.env.NANOPAQUETE_API_PORT ?? 8789)
const adminUser = process.env.NANOPAQUETE_ADMIN_USER ?? 'admin'
const adminPassword = process.env.NANOPAQUETE_ADMIN_PASSWORD ?? 'nanopaquete'
const escrowWallet =
  process.env.NANOPAQUETE_ESCROW_WALLET ??
  'nano_1j7csyciamkzktswyxey5yt6f1rg1zbw3rtioe7xdze4fekkbo7zxri3ijxd'
const custodianContact =
  process.env.NANOPAQUETE_CUSTODIAN_CONTACT ??
  'Configura NANOPAQUETE_CUSTODIAN_CONTACT con WhatsApp o Telegram'
const custodyFeeXno = process.env.NANOPAQUETE_CUSTODY_FEE_XNO ?? '0.1'
const sellerPaymentTtlMs = Number(process.env.NANOPAQUETE_SELLER_PAYMENT_TTL_MS ?? 60 * 60 * 1000)
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
      sellerPaymentIntents: Array.isArray(parsed.sellerPaymentIntents) ? parsed.sellerPaymentIntents : [],
      escrows: Array.isArray(parsed.escrows) ? parsed.escrows : [],
      offers: Array.isArray(parsed.offers) ? parsed.offers : [],
      usedPayments: Array.isArray(parsed.usedPayments) ? parsed.usedPayments : [],
    }
  } catch {
    return { sellerPaymentIntents: [], escrows: [], offers: [], usedPayments: [] }
  }
}

const writeStore = async (store: Store) => {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`)
}

const normalizeText = (value: unknown) => String(value ?? '').trim()
const isCurrency = (value: string): value is Currency => currencies.includes(value as Currency)

const createCode = (digits: number) => {
  const min = 10 ** (digits - 1)
  const range = 9 * min
  return String(min + (randomBytes(4).readUInt32BE(0) % range))
}

const createNanoPaymentUri = (receiver: string) => `nano:${receiver}`

const publicOffer = (offer: OfferRecord) => ({
  id: offer.id,
  amountXno: offer.amountXno,
  currency: offer.currency,
  price: offer.price,
  status: offer.status,
  createdAt: offer.createdAt,
})

const statusLabel = (status: OfferStatus) =>
  ({
    ACTIVE: 'Activa',
    NEGOTIATION: 'En negociacion',
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
              <dt>Contacto vendedor</dt><dd>${escapeHtml(offer.sellerContact)}</dd>
              <dt>Codigo vendedor</dt><dd>${escapeHtml(offer.sellerPrivateCode)}</dd>
              <dt>Wallet vendedor</dt><dd>${escapeHtml(offer.sellerWallet)}</dd>
              <dt>Hash deposito</dt><dd>${escapeHtml(offer.paymentHash)}</dd>
              <dt>Wallet comprador</dt><dd>${escapeHtml(offer.buyerNanoAddress)}</dd>
              <dt>Codigo comprador</dt><dd>${escapeHtml(offer.buyerCancelCode)}</dd>
              <dt>Creada</dt><dd>${escapeHtml(offer.createdAt)}</dd>
              <dt>Tomada</dt><dd>${escapeHtml(offer.takenAt)}</dd>
              <dt>Nota admin</dt><dd>${escapeHtml(offer.adminNote)}</dd>
            </dl>
            <form method="post" action="/admin/offers/${encodeURIComponent(offer.id)}/status">
              <select name="status">
                ${(['ACTIVE', 'NEGOTIATION', 'DISPUTED', 'CANCELLED', 'RELEASED'] as OfferStatus[])
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
    const store = await readStore()
    sendJson(response, 200, { offers: store.offers.filter((offer) => offer.status === 'ACTIVE').map(publicOffer) })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/seller-payments') {
    const store = await readStore()
    const now = Date.now()
    store.sellerPaymentIntents = store.sellerPaymentIntents.filter(
      (intent) => intent.status !== 'PENDING' || new Date(intent.expiresAt).getTime() > now,
    )
    const intent: SellerPaymentIntent = {
      id: `pay_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      receiverAddress: escrowWallet,
      status: 'PENDING',
      clientIp: getClientIp(request),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + sellerPaymentTtlMs).toISOString(),
    }
    store.sellerPaymentIntents.push(intent)
    await writeStore(store)

    sendJson(response, 201, {
      intentId: intent.id,
      receiverAddress: intent.receiverAddress,
      paymentUri: createNanoPaymentUri(intent.receiverAddress),
      expiresAt: intent.expiresAt,
      custodianContact,
    })
    return
  }

  const verifyPaymentMatch = url.pathname.match(/^\/api\/seller-payments\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyPaymentMatch) {
    const intentId = decodeURIComponent(verifyPaymentMatch[1])
    const store = await readStore()
    const intent = store.sellerPaymentIntents.find((item) => item.id === intentId)

    if (!intent) {
      sendJson(response, 404, { error: 'Solicitud de deposito no encontrada.' })
      return
    }

    if (intent.status === 'VERIFIED') {
      const escrow = store.escrows.find((item) => item.paymentIntentId === intent.id)
      if (!escrow) {
        sendJson(response, 409, { error: 'El pago fue verificado, pero falta la custodia asociada.' })
        return
      }
      sendJson(response, 200, {
        escrowId: escrow.id,
        publishToken: escrow.publishToken,
        amountXno: escrow.amountXno,
        sellerWallet: escrow.sellerWallet,
        paymentHash: escrow.paymentHash,
        custodianContact,
        escrowWallet,
        custodyFeeXno,
      })
      return
    }

    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      intent.status = 'EXPIRED'
      await writeStore(store)
      sendJson(response, 410, { error: 'La solicitud de deposito vencio. Inicia una nueva.' })
      return
    }

    try {
      const payment = await findAnyIncomingPayment({
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
        status: 'PENDING',
        clientIp: intent.clientIp,
        createdAt: new Date().toISOString(),
      }

      intent.status = 'VERIFIED'
      intent.paymentHash = payment.hash
      intent.senderWallet = payment.senderWallet
      intent.amountXno = payment.amountNano
      store.escrows.unshift(escrow)
      store.usedPayments.push({ hash: payment.hash, purpose: 'seller_deposit', createdAt: new Date().toISOString() })
      await writeStore(store)

      sendJson(response, 200, {
        escrowId: escrow.id,
        publishToken: escrow.publishToken,
        amountXno: escrow.amountXno,
        sellerWallet: escrow.sellerWallet,
        paymentHash: escrow.paymentHash,
        custodianContact,
        escrowWallet,
        custodyFeeXno,
      })
    } catch (error) {
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
    const sellerContact = normalizeText(body.sellerContact)

    if (!isCurrency(currency)) {
      sendJson(response, 400, { error: 'Selecciona una divisa valida.' })
      return
    }

    if (!price) {
      sendJson(response, 400, { error: 'Ingresa el precio esperado.' })
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
      sellerContact,
      sellerPrivateCode: createCode(8),
      sellerWallet: escrow.sellerWallet,
      paymentHash: escrow.paymentHash,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    }

    escrow.status = 'PUBLISHED'
    store.offers.unshift(offer)
    await writeStore(store)

    sendJson(response, 201, { offer: publicOffer(offer), sellerPrivateCode: offer.sellerPrivateCode, custodianContact, custodyFeeXno })
    return
  }

  const takeMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/take$/)

  if (request.method === 'POST' && takeMatch) {
    const offerId = decodeURIComponent(takeMatch[1])
    const body = await readJsonBody(request)
    const buyerNanoAddress = normalizeText(body.buyerNanoAddress)

    if (!isNanoAddress(buyerNanoAddress)) {
      sendJson(response, 400, { error: 'Ingresa una cuenta nano valida para recibir los XNO.' })
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

    offer.status = 'NEGOTIATION'
    offer.buyerNanoAddress = buyerNanoAddress
    offer.buyerCancelCode = createCode(8)
    offer.takenAt = new Date().toISOString()
    await writeStore(store)

    sendJson(response, 200, {
      offer: publicOffer(offer),
      sellerContact: offer.sellerContact,
      buyerCancelCode: offer.buyerCancelCode,
      custodianContact,
      custodyFeeXno,
    })
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
