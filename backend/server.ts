import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNanoAccount, findAnyIncomingPayment, findIncomingPaymentByAmount, isNanoAddress, nanoToRaw, sendFromPrivateKey } from './nano-rpc'

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
type OfferType = 'SELL' | 'BUY'

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
  offerType?: OfferType
  escrowId?: string
  escrowNanoAccountId?: string
  escrowNanoAddress?: string
  amountXno: string
  currency: Currency
  price: string
  sellerContact?: string
  custodianId: string
  sellerCountry?: string
  sellerDialCode?: string
  sellerPrivateCode?: string
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
  purpose: 'seller_deposit' | 'release_fee' | 'custodian_release' | 'custodian_auth' | 'cancellation_refund'
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

type NanoAccountStatus = 'AVAILABLE' | 'ASSIGNED' | 'LOCKED' | 'RETIRED'

type NanoAccountRecord = {
  id: string
  account: string
  publicKey: string
  encryptedPrivateKey: string
  keyFingerprint: string
  status: NanoAccountStatus
  purpose: 'ESCROW' | 'COMMISSION' | 'RESERVE'
  label?: string
  linkedOfferId?: string
  commissionAvailableXno: string
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  notes?: string
  withdrawalHistory: NanoAccountWithdrawal[]
}

type NanoAccountWithdrawal = {
  id: string
  amountXno: string
  destination: string
  txHash?: string
  createdAt: string
  note?: string
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
  nanoAccounts: NanoAccountRecord[]
}

const port = Number(process.env.NANOPAQUETE_API_PORT ?? 8789)
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
const configuredCustodyFeeBps = Number(process.env.NANOPAQUETE_CUSTODY_FEE_BPS ?? '20')
const custodyFeeBps = BigInt(
  Number.isFinite(configuredCustodyFeeBps) && configuredCustodyFeeBps >= 0
    ? Math.trunc(configuredCustodyFeeBps)
    : 20,
)
const custodianAuthAmountXno = process.env.NANOPAQUETE_CUSTODIAN_AUTH_XNO ?? '0.01'
const sellerPaymentTtlMs = Number(process.env.NANOPAQUETE_SELLER_PAYMENT_TTL_MS ?? 60 * 60 * 1000)
const releaseFeeTtlMs = Number(process.env.NANOPAQUETE_RELEASE_FEE_TTL_MS ?? 60 * 60 * 1000)
const custodianAuthTtlMs = Number(process.env.NANOPAQUETE_CUSTODIAN_AUTH_TTL_MS ?? 15 * 60 * 1000)
const custodianSessionTtlMs = Number(process.env.NANOPAQUETE_CUSTODIAN_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000)
const takenOfferCustodianReleaseMs = Number(process.env.NANOPAQUETE_TAKEN_OFFER_RELEASE_MS ?? 24 * 60 * 60 * 1000)
const nanoAccountSecret = process.env.NANOPAQUETE_ACCOUNT_SECRET ?? adminPassword
const nanoWalletId = process.env.NANO_WALLET_ID ?? ''
const __dirname = dirname(fileURLToPath(import.meta.url))
const storePath = join(__dirname, 'data', 'nanopaquete.json')
const offerOperationLocks = new Map<string, Promise<void>>()

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.NANOPAQUETE_ALLOWED_ORIGIN ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const sendJson = (response: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders, ...headers })
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

const custodianSessionCookieName = 'nanopaquete_custodian_session'

const getRequestCookie = (request: IncomingMessage, name: string) => {
  const cookieHeader = request.headers.cookie ?? ''
  return cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

const createCustodianSessionCookie = (session: CustodianSession) => {
  const maxAge = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000))
  return `${custodianSessionCookieName}=${encodeURIComponent(session.id)}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

const clearCustodianSessionCookie = () =>
  `${custodianSessionCookieName}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`

const getAdminCustodianSession = (store: Store, request: IncomingMessage) =>
  getValidCustodianSession(store, decodeURIComponent(getRequestCookie(request, custodianSessionCookieName) ?? ''))

const redirectToCustodianAuth = (response: ServerResponse) => {
  response.writeHead(303, { Location: '/?admin=1', ...corsHeaders })
  response.end()
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

const getEncryptionKey = () => createHash('sha256').update(nanoAccountSecret).digest()

const encryptSecret = (value: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

const decryptSecret = (value: string) => {
  const [ivValue, tagValue, encryptedValue] = value.split('.')
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Formato de clave cifrada invalido.')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

const getKeyFingerprint = (privateKey: string) =>
  createHash('sha256').update(privateKey).digest('hex').slice(0, 16).toUpperCase()

const nanoAccountStatuses: NanoAccountStatus[] = ['AVAILABLE', 'ASSIGNED', 'LOCKED', 'RETIRED']
const nanoAccountPurposes: NanoAccountRecord['purpose'][] = ['ESCROW', 'COMMISSION', 'RESERVE']

const normalizeNanoAccounts = (value: unknown): NanoAccountRecord[] => {
  if (!Array.isArray(value)) return []

  return value
    .filter((account): account is Partial<NanoAccountRecord> => Boolean(account && typeof account === 'object'))
    .filter((account) => Boolean(account.id && isNanoAddress(String(account.account ?? '')) && account.encryptedPrivateKey))
    .map((account) => {
      const status = nanoAccountStatuses.includes(account.status as NanoAccountStatus)
        ? account.status as NanoAccountStatus
        : 'AVAILABLE'
      const purpose = nanoAccountPurposes.includes(account.purpose as NanoAccountRecord['purpose'])
        ? account.purpose as NanoAccountRecord['purpose']
        : 'ESCROW'

      return {
        id: normalizeClientSessionId(account.id),
        account: normalizeText(account.account),
        publicKey: normalizeText(account.publicKey).toUpperCase(),
        encryptedPrivateKey: normalizeText(account.encryptedPrivateKey),
        keyFingerprint: normalizeText(account.keyFingerprint),
        status,
        purpose,
        label: normalizeText(account.label) || undefined,
        linkedOfferId: normalizeText(account.linkedOfferId) || undefined,
        commissionAvailableXno: normalizeText(account.commissionAvailableXno) || '0',
        createdAt: normalizeText(account.createdAt) || new Date().toISOString(),
        updatedAt: normalizeText(account.updatedAt) || new Date().toISOString(),
        lastUsedAt: normalizeText(account.lastUsedAt) || undefined,
        notes: normalizeText(account.notes) || undefined,
        withdrawalHistory: Array.isArray(account.withdrawalHistory)
          ? account.withdrawalHistory
              .filter((withdrawal): withdrawal is NanoAccountWithdrawal => Boolean(withdrawal && typeof withdrawal === 'object'))
              .map((withdrawal) => ({
                id: normalizeClientSessionId(withdrawal.id) || `wdr_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
                amountXno: normalizeText(withdrawal.amountXno) || '0',
                destination: normalizeText(withdrawal.destination),
                txHash: normalizeText(withdrawal.txHash) || undefined,
                createdAt: normalizeText(withdrawal.createdAt) || new Date().toISOString(),
                note: normalizeText(withdrawal.note) || undefined,
              }))
          : [],
      }
    })
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
      nanoAccounts: normalizeNanoAccounts(parsed.nanoAccounts),
    }
  } catch {
    return { custodians: sanitizeCustodians(getConfiguredCustodians()), sellerPaymentIntents: [], custodianAuthIntents: [], custodianSessions: [], releaseFeeIntents: [], escrows: [], offers: [], usedPayments: [], nanoAccounts: [] }
  }
}

const writeStore = async (store: Store) => {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify({ ...store, custodians: sanitizeCustodians(store.custodians), nanoAccounts: normalizeNanoAccounts(store.nanoAccounts) }, null, 2)}\n`)
}

const withOfferLock = async <T>(offerId: string, operation: () => Promise<T>) => {
  const previous = offerOperationLocks.get(offerId) ?? Promise.resolve()
  let release = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  offerOperationLocks.set(offerId, queued)

  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    release()
    if (offerOperationLocks.get(offerId) === queued) offerOperationLocks.delete(offerId)
  }
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const sendFromTemporaryAccountWithRetry = async (
  options: Parameters<typeof sendFromPrivateKey>[0],
  retries = 3,
  delayMs = 2500,
) => {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await sendFromPrivateKey(options)
    } catch (error) {
      lastError = error
      if (attempt < retries) await wait(delayMs)
    }
  }

  throw lastError
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

const rawToNano = (raw: bigint) => {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const base = 10n ** 30n
  const whole = absolute / base
  const fraction = (absolute % base).toString().padStart(30, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`
}

const addNanoAmounts = (...amounts: string[]) =>
  rawToNano(amounts.reduce((total, amount) => total + BigInt(nanoToRaw(amount)), 0n))

const getCustodyFeeXno = (amountXno: string) =>
  rawToNano((BigInt(nanoToRaw(amountXno)) * custodyFeeBps) / 10000n)

const getOfferEscrowAccount = (store: Store, offer: OfferRecord) =>
  offer.escrowNanoAccountId
    ? store.nanoAccounts.find((account) => account.id === offer.escrowNanoAccountId)
    : store.nanoAccounts.find((account) => account.linkedOfferId === offer.id)

const assignEscrowAccountToOffer = async (store: Store, offer: OfferRecord) => {
  const existing = getOfferEscrowAccount(store, offer)
  if (existing) {
    existing.status = 'ASSIGNED'
    existing.purpose = 'ESCROW'
    existing.linkedOfferId = offer.id
    existing.label = existing.label || `Custodia oferta ${offer.id}`
    existing.updatedAt = new Date().toISOString()
    existing.lastUsedAt = existing.lastUsedAt ?? existing.updatedAt
    offer.escrowNanoAccountId = existing.id
    offer.escrowNanoAddress = existing.account
    return existing
  }

  const available = store.nanoAccounts.find(
    (account) => account.status === 'AVAILABLE' && account.purpose === 'ESCROW' && !account.linkedOfferId,
  )
  const account = available ?? await createNanoAccountRecord({
    label: `Custodia oferta ${offer.id}`,
    purpose: 'ESCROW',
    notes: 'Cuenta temporal asignada automaticamente a una negociacion.',
  })

  if (!available) store.nanoAccounts.unshift(account)
  account.status = 'ASSIGNED'
  account.purpose = 'ESCROW'
  account.linkedOfferId = offer.id
  account.label = account.label || `Custodia oferta ${offer.id}`
  account.updatedAt = new Date().toISOString()
  account.lastUsedAt = account.updatedAt
  offer.escrowNanoAccountId = account.id
  offer.escrowNanoAddress = account.account
  return account
}

const releaseUnusedEscrowAccount = (store: Store, offer: OfferRecord) => {
  const account = getOfferEscrowAccount(store, offer)
  if (!account || offer.paymentHash) return
  account.status = 'AVAILABLE'
  account.linkedOfferId = undefined
  account.updatedAt = new Date().toISOString()
  offer.escrowNanoAccountId = undefined
  offer.escrowNanoAddress = undefined
}

const refundDetectedDepositBeforeCancel = async (store: Store, offer: OfferRecord) => {
  const escrowAccount = getOfferEscrowAccount(store, offer)
  if (!escrowAccount) return undefined

  const activeIntent = store.releaseFeeIntents.find(
    (intent) =>
      intent.offerId === offer.id &&
      intent.status === 'PENDING' &&
      intent.receiverAddress === escrowAccount.account,
  )

  if (!activeIntent) return undefined

  let payment: Awaited<ReturnType<typeof findIncomingPaymentByAmount>>
  try {
    payment = await findIncomingPaymentByAmount({
      receiverWallet: activeIntent.receiverAddress,
      amountNano: activeIntent.amountXno,
      createdAfter: activeIntent.createdAt,
      excludedHashes: store.usedPayments.map((item) => item.hash),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!message.includes('No encontre') && !message.includes('aun no aparece')) throw error
    return undefined
  }

  const refund = await sendFromPrivateKey({
    walletId: nanoWalletId,
    privateKey: decryptSecret(escrowAccount.encryptedPrivateKey),
    sourceAccount: escrowAccount.account,
    destinationAccount: payment.senderWallet,
    amountNano: payment.amountNano,
  })

  activeIntent.status = 'EXPIRED'
  activeIntent.paymentHash = payment.hash
  activeIntent.senderWallet = payment.senderWallet
  store.usedPayments.push({ hash: payment.hash, purpose: 'seller_deposit', createdAt: new Date().toISOString() })
  store.usedPayments.push({ hash: refund.blockHash, purpose: 'cancellation_refund', createdAt: new Date().toISOString() })
  escrowAccount.notes = [
    escrowAccount.notes,
    `Deposito ${payment.hash} devuelto por cancelacion inmediata a ${payment.senderWallet}. Retiro: ${refund.blockHash}.`,
  ].filter(Boolean).join('\n')
  escrowAccount.updatedAt = new Date().toISOString()

  return refund.blockHash
}

const releaseOfferFunds = async (store: Store, offer: OfferRecord) => {
  if (offer.status === 'RELEASED' && offer.custodianReleaseHash) {
    return { blockHash: offer.custodianReleaseHash, receivedBlocks: [] }
  }

  if (!offer.paymentHash) throw new Error('Primero confirma el deposito Nano en custodia.')
  if (!offer.buyerNanoAddress) throw new Error('Esta oferta no tiene wallet compradora registrada.')

  const escrowAccount = getOfferEscrowAccount(store, offer)
  if (!escrowAccount) throw new Error('Esta oferta no tiene cuenta temporal de custodia asociada.')

  const withdrawal = await sendFromTemporaryAccountWithRetry({
    walletId: nanoWalletId,
    privateKey: decryptSecret(escrowAccount.encryptedPrivateKey),
    sourceAccount: escrowAccount.account,
    destinationAccount: offer.buyerNanoAddress,
    amountNano: offer.amountXno,
  })

  offer.status = 'RELEASED'
  offer.custodianReleaseHash = withdrawal.blockHash
  offer.closedAt = new Date().toISOString()
  const custodyFeeXno = getCustodyFeeXno(offer.amountXno)
  escrowAccount.commissionAvailableXno = addNanoAmounts(escrowAccount.commissionAvailableXno || '0', custodyFeeXno)
  escrowAccount.updatedAt = new Date().toISOString()
  escrowAccount.notes = [
    escrowAccount.notes,
    `Liberacion de ${offer.amountXno} XNO a ${offer.buyerNanoAddress}. Comision disponible: ${custodyFeeXno} XNO.`,
  ].filter(Boolean).join('\n')
  store.usedPayments.push({ hash: withdrawal.blockHash, purpose: 'custodian_release', createdAt: new Date().toISOString() })

  return withdrawal
}

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
  const offerType = offer.offerType ?? 'SELL'
  offer.status = 'ACTIVE'
  if (offerType === 'SELL') {
    offer.buyerNanoAddress = undefined
    offer.buyerCountry = undefined
    offer.buyerDialCode = undefined
    offer.buyerContact = undefined
    offer.buyerSessionId = undefined
  } else {
    offer.sellerCountry = undefined
    offer.sellerDialCode = undefined
    offer.sellerContact = undefined
    offer.sellerSessionId = undefined
  }
  offer.takenAt = undefined
  offer.releaseFeeIntentId = undefined
  offer.escrowNanoAccountId = undefined
  offer.escrowNanoAddress = undefined
}


const publicOffer = (offer: OfferRecord, context: { clientSessionId?: string; custodianSession?: CustodianSession } = {}) => {
  const offerType = offer.offerType ?? 'SELL'
  const isSellPublisher = Boolean(offerType === 'SELL' && context.clientSessionId && offer.sellerSessionId && offer.sellerSessionId === context.clientSessionId)
  const isBuyPublisher = Boolean(offerType === 'BUY' && context.clientSessionId && offer.buyerSessionId === context.clientSessionId)
  const isPublisher = isSellPublisher || isBuyPublisher
  const isNanoSeller = Boolean(context.clientSessionId && offer.sellerSessionId && offer.sellerSessionId === context.clientSessionId)
  const isTaker = Boolean(
    context.clientSessionId &&
    (offerType === 'BUY'
      ? offer.sellerSessionId === context.clientSessionId
      : offer.buyerSessionId === context.clientSessionId),
  )
  const isCustodian = Boolean(context.custodianSession && context.custodianSession.custodianId === offer.custodianId)

  return {
    id: offer.id,
    offerType,
    amountXno: offer.amountXno,
    currency: offer.currency,
    price: offer.price,
    status: offer.status,
    createdAt: offer.createdAt,
    isOwnOffer: isPublisher || isNanoSeller,
    isPublishedOffer: isPublisher,
    canEditPrice: isPublisher && offer.status === 'ACTIVE',
    canDeleteOffer: isPublisher && offer.status === 'ACTIVE',
    canDepositNano: isNanoSeller && offer.status === 'NEGOTIATION' && !offer.paymentHash,
    canConfirmPayment: isNanoSeller && Boolean(offer.paymentHash) && (
      offer.status === 'NEGOTIATION' ||
      (offer.status === 'RELEASING' && !offer.custodianReleaseHash)
    ),
    canCancelTake: (isPublisher || isTaker) && offer.status === 'NEGOTIATION' && !offer.paymentHash,
    canCustodianReleaseOffer: isCustodian && canCustodianReleaseTakenOffer(offer),
    canCustodianReleaseFunds: isCustodian && offer.status === 'RELEASING',
    sellerDepositConfirmed: Boolean(offer.paymentHash),
    ...(isSellPublisher && offer.status === 'NEGOTIATION' && offer.paymentHash && offer.buyerContact
      ? {
          buyerCountry: offer.buyerCountry,
          buyerDialCode: offer.buyerDialCode,
          buyerContact: offer.buyerContact,
        }
      : {}),
    ...(isBuyPublisher && offer.status === 'NEGOTIATION' && offer.paymentHash && offer.sellerContact
      ? {
          sellerCountry: offer.sellerCountry,
          sellerDialCode: offer.sellerDialCode,
          sellerContact: offer.sellerContact,
        }
      : {}),
    ...(isNanoSeller && offer.status === 'NEGOTIATION' && offer.paymentHash && offer.buyerContact
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
  }
}

const takenOfferResponse = (store: Store, offer: OfferRecord, clientSessionId?: string) => ({
  offer: publicOffer(offer, { clientSessionId }),
  sellerContact: offer.paymentHash ? offer.sellerContact ?? '' : '',
  sellerCountry: offer.paymentHash ? offer.sellerCountry : undefined,
  sellerDialCode: offer.paymentHash ? offer.sellerDialCode : undefined,
  buyerContact: offer.paymentHash ? offer.buyerContact ?? '' : '',
  buyerCountry: offer.paymentHash ? offer.buyerCountry : undefined,
  buyerDialCode: offer.paymentHash ? offer.buyerDialCode : undefined,
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
  escrowWallet: custodian.wallet,
  custodyFeeXno: getCustodyFeeXno(escrow.amountXno),
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
      nav { display: flex; gap: 12px; margin-top: 12px; }
      nav a { color: white; }
      main { padding: 24px 32px; display: grid; gap: 18px; }
      article { background: white; border: 1px solid #d8ded6; border-radius: 8px; padding: 18px; }
      dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; margin: 0 0 16px; }
      dt { color: #657064; }
      dd { margin: 0; overflow-wrap: anywhere; }
      form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      select, input, button { min-height: 38px; border-radius: 6px; border: 1px solid #bfc9bd; padding: 0 10px; }
      button { background: #206b3a; color: white; border-color: #206b3a; cursor: pointer; }
      .offer-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .danger { background: #a83434; border-color: #a83434; }
      button:disabled { background: #d7ddd5; border-color: #c7cec5; color: #657064; cursor: not-allowed; }
      .muted { color: #657064; font-size: 13px; }
      .status { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: #e7efe5; font-weight: 700; }
    </style>
  </head>
  <body>
    <header>
      <h1>Nanopaquete Admin</h1>
      <p>Panel manual de custodia, disputas y cierre de operaciones.</p>
      <nav>
        <a href="/?admin=1">Panel principal</a>
        <a href="/admin/offers">Ofertas</a>
        <a href="/admin/nano-accounts">Cuentas Nano</a>
      </nav>
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
              <dt>Cuenta temporal</dt><dd>${escapeHtml(offer.escrowNanoAddress)}</dd>
              <dt>ID cuenta temporal</dt><dd>${escapeHtml(offer.escrowNanoAccountId)}</dd>
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
            <div class="offer-actions">
              <form method="post" action="/admin/offers/${encodeURIComponent(offer.id)}/status">
                <select name="status">
                  ${(['ACTIVE', 'NEGOTIATION', 'RELEASING', 'DISPUTED', 'CANCELLED', 'RELEASED'] as OfferStatus[])
                    .map((status) => `<option value="${status}" ${status === offer.status ? 'selected' : ''}>${statusLabel(status)}</option>`)
                    .join('')}
                </select>
                <input name="adminNote" placeholder="Nota interna" value="${escapeHtml(offer.adminNote)}" />
                <button>Actualizar</button>
              </form>
              ${
                offer.status === 'CANCELLED' || offer.status === 'RELEASED'
                  ? `<form method="post" action="/admin/offers/${encodeURIComponent(offer.id)}/delete" onsubmit="return confirm('Eliminar esta oferta cerrada del panel? Esta accion no borra cuentas Nano ni transacciones.');">
                      <button class="danger">Eliminar</button>
                    </form>`
                  : `<form method="post" action="/admin/offers/${encodeURIComponent(offer.id)}/delete">
                      <button class="danger" disabled>Eliminar</button>
                      <span class="muted">Disponible cuando este Cancelada o Liberada.</span>
                    </form>`
              }
            </div>
          </article>`,
        )
        .join('') || '<article>No hay ofertas registradas.</article>'}
    </main>
  </body>
</html>`

const nanoAccountStatusLabel = (status: NanoAccountStatus) =>
  ({
    AVAILABLE: 'Disponible',
    ASSIGNED: 'Asignada',
    LOCKED: 'Bloqueada',
    RETIRED: 'Retirada',
  })[status]

const renderNanoAccountsAdmin = (accounts: NanoAccountRecord[], destinationWallet: string, message = '') => `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cuentas Nano - Nanopaquete</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f5f7f4; color: #172019; }
      header { padding: 24px 32px; background: #18241c; color: white; }
      nav { display: flex; gap: 12px; margin-top: 12px; }
      nav a { color: white; }
      main { padding: 24px 32px; display: grid; gap: 18px; }
      section, article { background: white; border: 1px solid #d8ded6; border-radius: 8px; padding: 18px; }
      dl { display: grid; grid-template-columns: 190px 1fr; gap: 8px 16px; margin: 0 0 16px; }
      dt { color: #657064; }
      dd { margin: 0; overflow-wrap: anywhere; }
      form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
      label { display: grid; gap: 4px; font-size: 13px; color: #4f5c52; }
      select, input, button, textarea { min-height: 38px; border-radius: 6px; border: 1px solid #bfc9bd; padding: 0 10px; font: inherit; }
      textarea { padding: 10px; min-width: min(520px, 100%); min-height: 64px; }
      button { background: #206b3a; color: white; border-color: #206b3a; cursor: pointer; }
      .danger { background: #8f2d1f; border-color: #8f2d1f; }
      .status { display: inline-flex; padding: 4px 8px; border-radius: 999px; background: #e7efe5; font-weight: 700; }
      .message { border-color: #9bc6a4; background: #eef8ef; }
      .muted { color: #657064; }
      .withdrawals { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e9e3; }
    </style>
  </head>
  <body>
    <header>
      <h1>Cuentas Nano</h1>
      <p>Generacion y administracion de cuentas de custodia para Nanopaquete.</p>
      <nav>
        <a href="/?admin=1">Panel principal</a>
        <a href="/admin/offers">Ofertas</a>
        <a href="/admin/nano-accounts">Cuentas Nano</a>
      </nav>
    </header>
    <main>
      ${message ? `<section class="message">${escapeHtml(message)}</section>` : ''}
      <section>
        <h2>Generar cuenta</h2>
        <p class="muted">La clave privada se cifra antes de guardarse. Define <code>NANOPAQUETE_ACCOUNT_SECRET</code> en produccion para no depender de la clave admin.</p>
        <form method="post" action="/admin/nano-accounts/generate">
          <label>
            Etiqueta
            <input name="label" placeholder="Ej. custodia inicial" />
          </label>
          <label>
            Nota
            <input name="notes" placeholder="Nota interna opcional" />
          </label>
          <button>Generar cuenta Nano</button>
        </form>
      </section>
      ${accounts
        .map(
          (account) => `<article>
            <h2>${escapeHtml(account.label || account.id)}</h2>
            <dl>
              <dt>Estado</dt><dd><span class="status">${nanoAccountStatusLabel(account.status)}</span></dd>
              <dt>Cuenta Nano</dt><dd>${escapeHtml(account.account)}</dd>
              <dt>Clave publica</dt><dd>${escapeHtml(account.publicKey)}</dd>
              <dt>Huella de clave</dt><dd>${escapeHtml(account.keyFingerprint)}</dd>
              <dt>Oferta vinculada</dt><dd>${escapeHtml(account.linkedOfferId)}</dd>
              <dt>Comision disponible</dt><dd>${escapeHtml(account.commissionAvailableXno)} XNO</dd>
              <dt>Creada</dt><dd>${escapeHtml(account.createdAt)}</dd>
              <dt>Actualizada</dt><dd>${escapeHtml(account.updatedAt)}</dd>
              <dt>Ultimo uso</dt><dd>${escapeHtml(account.lastUsedAt)}</dd>
              <dt>Notas</dt><dd>${escapeHtml(account.notes)}</dd>
            </dl>
            <form method="post" action="/admin/nano-accounts/${encodeURIComponent(account.id)}/update">
              <label>
                Estado
                <select name="status">
                  ${nanoAccountStatuses
                    .map((status) => `<option value="${status}" ${status === account.status ? 'selected' : ''}>${nanoAccountStatusLabel(status)}</option>`)
                    .join('')}
                </select>
              </label>
              <label>
                Etiqueta
                <input name="label" value="${escapeHtml(account.label)}" />
              </label>
              <label>
                Oferta vinculada
                <input name="linkedOfferId" value="${escapeHtml(account.linkedOfferId)}" />
              </label>
              <label>
                Comision disponible XNO
                <input name="commissionAvailableXno" value="${escapeHtml(account.commissionAvailableXno)}" />
              </label>
              <label>
                Nota
                <textarea name="notes">${escapeHtml(account.notes)}</textarea>
              </label>
              <button>Guardar cambios</button>
            </form>
            <form method="post" action="/admin/nano-accounts/${encodeURIComponent(account.id)}/withdraw">
              <label>
                Wallet destino
                <input name="destination" value="${escapeHtml(destinationWallet)}" required />
              </label>
              <label>
                Monto
                <input value="${escapeHtml(account.commissionAvailableXno)} XNO" readonly />
              </label>
              <button class="danger">Retirar fondos</button>
            </form>
            <div class="withdrawals">
              <strong>Retiros</strong>
              ${
                account.withdrawalHistory.length
                  ? account.withdrawalHistory
                      .map(
                        (withdrawal) => `<dl>
                          <dt>Fecha</dt><dd>${escapeHtml(withdrawal.createdAt)}</dd>
                          <dt>Monto</dt><dd>${escapeHtml(withdrawal.amountXno)} XNO</dd>
                          <dt>Destino</dt><dd>${escapeHtml(withdrawal.destination)}</dd>
                          <dt>Hash</dt><dd>${escapeHtml(withdrawal.txHash)}</dd>
                          <dt>Nota</dt><dd>${escapeHtml(withdrawal.note)}</dd>
                        </dl>`,
                      )
                      .join('')
                  : '<p class="muted">Sin retiros registrados.</p>'
              }
            </div>
          </article>`,
        )
        .join('') || '<article>No hay cuentas Nano registradas.</article>'}
    </main>
  </body>
</html>`

const createNanoAccountRecord = async ({
  label,
  purpose,
  notes,
}: {
  label?: string
  purpose: NanoAccountRecord['purpose']
  notes?: string
}): Promise<NanoAccountRecord> => {
  const generated = await createNanoAccount()
  const now = new Date().toISOString()

  return {
    id: `nac_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
    account: generated.account,
    publicKey: generated.publicKey,
    encryptedPrivateKey: encryptSecret(generated.privateKey),
    keyFingerprint: getKeyFingerprint(generated.privateKey),
    status: 'AVAILABLE',
    purpose,
    label: label || undefined,
    commissionAvailableXno: '0',
    createdAt: now,
    updatedAt: now,
    notes: notes || undefined,
    withdrawalHistory: [],
  }
}

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
      sendJson(response, 403, { error: 'Autenticacion autorizada requerida.' })
      return
    }

    await writeStore(store)
    sendJson(response, 200, { custodians: getStoreCustodians(store), canManage: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/custodian-admin/custodians') {
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const wallet = normalizeText(body.wallet)
    const store = await readStore()
    const custodianSession = getValidCustodianSession(store, custodianSessionId)

    if (!custodianSession) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Autenticacion autorizada requerida.' })
      return
    }

    if (!isNanoAddress(wallet)) {
      await writeStore(store)
      sendJson(response, 400, { error: 'Ingresa una direccion Nano valida.' })
      return
    }

    const existingCustodians = getStoreCustodians(store)
    if (existingCustodians.some((custodian) => custodian.wallet === wallet)) {
      await writeStore(store)
      sendJson(response, 409, { error: 'Esa direccion Nano ya esta autorizada.' })
      return
    }

    const custodian: Custodian = {
      id: createCustodianId(wallet.slice(0, 16)),
      name: 'Direccion autorizada',
      wallet,
      contact: wallet,
      isLeader: false,
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

    if (!custodianSession) {
      await writeStore(store)
      sendJson(response, 403, { error: 'Autenticacion autorizada requerida.' })
      return
    }

    const existingCustodians = getStoreCustodians(store)
    const custodian = existingCustodians.find((item) => item.id === custodianId)

    if (!custodian) {
      await writeStore(store)
      sendJson(response, 404, { error: 'Direccion autorizada no encontrada.' })
      return
    }

    if (custodian.isLeader && getLeaderCustodians(store).length <= 1) {
      await writeStore(store)
      sendJson(response, 409, { error: 'No se puede eliminar la direccion base de autenticacion.' })
      return
    }

    const hasLinkedRecords =
      store.offers.some((offer) => offer.custodianId === custodianId) ||
      store.escrows.some((escrow) => escrow.custodianId === custodianId) ||
      store.sellerPaymentIntents.some((intent) => intent.custodianId === custodianId)

    if (hasLinkedRecords) {
      await writeStore(store)
      sendJson(response, 409, { error: 'No se puede eliminar una direccion con ofertas, custodias o depositos asociados.' })
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
    sendJson(response, 410, { error: 'La gestion de lideres fue desactivada.' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/buyer-negotiation') {
    const clientSessionId = normalizeClientSessionId(url.searchParams.get('clientSessionId'))
    const store = await readStore()
    const offer = store.offers.find(
      (item) =>
        ['NEGOTIATION', 'RELEASING'].includes(item.status) &&
        (item.buyerSessionId === clientSessionId || item.sellerSessionId === clientSessionId),
    )

    sendJson(response, 200, { negotiation: offer ? takenOfferResponse(store, offer, clientSessionId) : null })
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

  if (request.method === 'POST' && url.pathname === '/api/custodian-auth/logout') {
    const body = await readJsonBody(request)
    const custodianSessionId = normalizeClientSessionId(body.custodianSessionId)
    const store = await readStore()
    store.custodianSessions = store.custodianSessions.filter((session) => session.id !== custodianSessionId)
    await writeStore(store)
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearCustodianSessionCookie() })
    return
  }

  const verifyCustodianAuthMatch = url.pathname.match(/^\/api\/custodian-auth\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyCustodianAuthMatch) {
    const intentId = decodeURIComponent(verifyCustodianAuthMatch[1])
    const store = await readStore()
    const intent = store.custodianAuthIntents.find((item) => item.id === intentId)

    if (!intent) {
      sendJson(response, 404, { error: 'Autenticacion autorizada no encontrada.' })
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
      sendJson(response, 410, { error: 'La autenticacion vencio porque la direccion receptora ya no esta disponible. Inicia una nueva.' })
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
        sendJson(response, 403, { error: 'Esta wallet no esta autorizada para ingresar.' })
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
      sendJson(
        response,
        200,
        { sessionId: session.id, expiresAt: session.expiresAt, custodianId: authenticatedCustodian.id, custodianName: 'Direccion autorizada', isLeader: true },
        { 'Set-Cookie': createCustodianSessionCookie(session) },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo autenticar la direccion autorizada.'
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
    const amountXno = normalizeText(body.amountXno).replace(',', '.')
    const currency = normalizeText(body.currency).toUpperCase()
    const price = normalizeText(body.price)
    const sellerCountry = normalizeText(body.sellerCountry)
    const sellerDialCode = normalizeText(body.sellerDialCode)
    const sellerContact = normalizeText(body.sellerContact)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)

    try {
      if (BigInt(nanoToRaw(amountXno)) <= 0n) throw new Error('Monto invalido')
    } catch {
      sendJson(response, 400, { error: 'Ingresa la cantidad de XNO que vas a vender.' })
      return
    }

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
    const custodian = getCustodianById(store, normalizeText(body.custodianId))

    const offer: OfferRecord = {
      id: `of_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      offerType: 'SELL',
      amountXno,
      currency,
      price,
      sellerCountry,
      sellerDialCode,
      sellerContact,
      sellerPrivateCode: createCode(8),
      custodianId: custodian.id,
      sellerSessionId: clientSessionId || undefined,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    }

    store.offers.unshift(offer)
    await writeStore(store)

    sendJson(response, 201, { offer: publicOffer(offer, { clientSessionId }), sellerPrivateCode: offer.sellerPrivateCode, custodyFeeXno: getCustodyFeeXno(offer.amountXno) })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/buy-offers') {
    const body = await readJsonBody(request)
    const amountXno = normalizeText(body.amountXno).replace(',', '.')
    const currency = normalizeText(body.currency).toUpperCase()
    const price = normalizeText(body.price)
    const buyerNanoAddress = normalizeText(body.buyerNanoAddress)
    const buyerCountry = normalizeText(body.buyerCountry)
    const buyerDialCode = normalizeText(body.buyerDialCode)
    const buyerContact = normalizeText(body.buyerContact)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)

    try {
      if (BigInt(nanoToRaw(amountXno)) <= 0n) throw new Error('Monto invalido')
    } catch {
      sendJson(response, 400, { error: 'Ingresa la cantidad de XNO que quieres comprar.' })
      return
    }

    if (!isCurrency(currency)) {
      sendJson(response, 400, { error: 'Selecciona un activo valido.' })
      return
    }

    if (!price) {
      sendJson(response, 400, { error: 'Ingresa la cantidad del activo que entregas.' })
      return
    }

    if (!isNanoAddress(buyerNanoAddress)) {
      sendJson(response, 400, { error: 'Ingresa una cuenta Nano valida para recibir los XNO.' })
      return
    }

    if (!buyerCountry || !buyerDialCode || buyerContact.length < 6) {
      sendJson(response, 400, { error: 'Ingresa pais, extension y contacto valido.' })
      return
    }

    const store = await readStore()
    const custodian = getActiveCustodian(store)
    const offer: OfferRecord = {
      id: `of_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      offerType: 'BUY',
      amountXno,
      currency,
      price,
      buyerNanoAddress,
      buyerCountry,
      buyerDialCode,
      buyerContact,
      buyerSessionId: clientSessionId || undefined,
      custodianId: custodian.id,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    }

    store.offers.unshift(offer)
    await writeStore(store)
    sendJson(response, 201, { offer: publicOffer(offer, { clientSessionId }), sellerPrivateCode: '', custodyFeeXno: getCustodyFeeXno(offer.amountXno) })
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

    const offerType = offer.offerType ?? 'SELL'
    const isOwner = offerType === 'BUY'
      ? Boolean(offer.buyerSessionId && offer.buyerSessionId === clientSessionId)
      : Boolean(offer.sellerSessionId && offer.sellerSessionId === clientSessionId)

    if (!isOwner) {
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

  const deleteOfferMatch = url.pathname.match(/^\/api\/offers\/([^/]+)$/)

  if (request.method === 'DELETE' && deleteOfferMatch) {
    const offerId = decodeURIComponent(deleteOfferMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    const offerType = offer.offerType ?? 'SELL'
    const isOwner = offerType === 'BUY'
      ? Boolean(offer.buyerSessionId && offer.buyerSessionId === clientSessionId)
      : Boolean(offer.sellerSessionId && offer.sellerSessionId === clientSessionId)

    if (!isOwner) {
      sendJson(response, 403, { error: 'Solo la sesion que publico la oferta puede eliminarla.' })
      return
    }

    if (offer.status !== 'ACTIVE') {
      sendJson(response, 409, { error: 'Solo puedes eliminar una oferta disponible.' })
      return
    }

    offer.status = 'CANCELLED'
    offer.closedAt = new Date().toISOString()
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

    const store = await readStore()
    const offer = store.offers.find((item) => item.id === offerId)

    if (!offer) {
      sendJson(response, 404, { error: 'La oferta no existe.' })
      return
    }

    const offerType = offer.offerType ?? 'SELL'

    if (offerType === 'SELL' && !isNanoAddress(buyerNanoAddress)) {
      sendJson(response, 400, { error: 'Ingresa una cuenta nano valida para recibir los XNO.' })
      return
    }

    if (!buyerCountry || !buyerDialCode || buyerContact.length < 6) {
      sendJson(response, 400, { error: 'Ingresa pais, extension y contacto valido.' })
      return
    }

    if (offer.status !== 'ACTIVE') {
      sendJson(response, 409, { error: 'Esta oferta ya no esta disponible.' })
      return
    }

    if (
      (offerType === 'SELL' && offer.sellerSessionId && offer.sellerSessionId === clientSessionId) ||
      (offerType === 'BUY' && offer.buyerSessionId && offer.buyerSessionId === clientSessionId)
    ) {
      sendJson(response, 403, { error: 'No puedes tomar una oferta que publicaste desde esta sesion.' })
      return
    }

    const currentNegotiation = store.offers.find(
      (item) =>
        ['NEGOTIATION', 'RELEASING'].includes(item.status) &&
        (item.buyerSessionId === clientSessionId || item.sellerSessionId === clientSessionId),
    )

    if (currentNegotiation) {
      sendJson(response, 409, { error: 'Ya tienes una negociacion abierta. Cancela o cierra esa negociacion antes de tomar otra oferta.' })
      return
    }

    offer.status = 'NEGOTIATION'
    if (offerType === 'SELL') {
      offer.buyerNanoAddress = buyerNanoAddress
      offer.buyerCountry = buyerCountry
      offer.buyerDialCode = buyerDialCode
      offer.buyerContact = buyerContact
      offer.buyerSessionId = clientSessionId || undefined
    } else {
      offer.sellerCountry = buyerCountry
      offer.sellerDialCode = buyerDialCode
      offer.sellerContact = buyerContact
      offer.sellerSessionId = clientSessionId || undefined
    }
    offer.takenAt = new Date().toISOString()
    await assignEscrowAccountToOffer(store, offer)
    await writeStore(store)

    sendJson(response, 200, takenOfferResponse(store, offer, clientSessionId))
    return
  }

  const cancelTakeMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/cancel-take$/)

  if (request.method === 'POST' && cancelTakeMatch) {
    const offerId = decodeURIComponent(cancelTakeMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    await withOfferLock(offerId, async () => {
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

      const offerType = offer.offerType ?? 'SELL'
      const publisherSessionId = offerType === 'BUY' ? offer.buyerSessionId : offer.sellerSessionId
      const takerSessionId = offerType === 'BUY' ? offer.sellerSessionId : offer.buyerSessionId
      const canCancel = Boolean(clientSessionId && (publisherSessionId === clientSessionId || takerSessionId === clientSessionId))

      if (!canCancel) {
        sendJson(response, 403, { error: 'Solo el comprador o vendedor de esta negociacion pueden cancelar este proceso.' })
        return
      }

      if (offer.paymentHash) {
        sendJson(response, 409, { error: 'La oferta ya tiene deposito Nano confirmado y no puede volver a activa.' })
        return
      }

      let refundHash: string | undefined
      try {
        refundHash = await refundDetectedDepositBeforeCancel(store, offer)
      } catch (error) {
        sendJson(response, 409, { error: error instanceof Error ? error.message : 'Se detecto un deposito y no se pudo devolver automaticamente.' })
        return
      }

      releaseUnusedEscrowAccount(store, offer)
      releaseTakenOffer(offer)
      await writeStore(store)

      sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), refundHash })
    })
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

    if (offer.paymentHash) {
      sendJson(response, 409, { error: 'La oferta ya tiene deposito Nano confirmado y debe resolverse como disputa o liberacion.' })
      return
    }

    releaseUnusedEscrowAccount(store, offer)
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
      sendJson(response, 403, { error: 'Solo la sesion vendedora que publico la oferta puede depositar los XNO.' })
      return
    }

    if (offer.paymentHash) {
      sendJson(response, 409, { error: 'El deposito de esta oferta ya fue confirmado.' })
      return
    }

    const escrowAccount = await assignEscrowAccountToOffer(store, offer)
    const now = Date.now()
    store.releaseFeeIntents = store.releaseFeeIntents.filter(
      (intent) => intent.status !== 'PENDING' || new Date(intent.expiresAt).getTime() > now,
    )
    const custodyFeeXno = getCustodyFeeXno(offer.amountXno)
    const depositAmountXno = addNanoAmounts(offer.amountXno, custodyFeeXno)
    const existing = store.releaseFeeIntents.find(
      (intent) => intent.offerId === offer.id && intent.status === 'PENDING' && intent.receiverAddress === escrowAccount.account,
    )

    if (existing) {
      if (existing.amountXno !== depositAmountXno) {
        existing.status = 'EXPIRED'
      } else {
        sendJson(response, 200, existing)
        return
      }
    }

    const intent: ReleaseFeeIntent = {
      id: `rel_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      offerId: offer.id,
      senderWallet: '',
      receiverAddress: escrowAccount.account,
      amountXno: depositAmountXno,
      paymentUri: createNanoPaymentUri(escrowAccount.account, depositAmountXno),
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

    try {
      const withdrawal = await releaseOfferFunds(store, offer)
      await writeStore(store)
      sendJson(response, 200, { offer: publicOffer(offer, { custodianSession }), paymentHash: withdrawal.blockHash })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo validar la liberacion del custodio.'
      sendJson(response, 422, {
        error: `${message.replace('wallet vendedora', 'wallet de custodia')} Se intento liberar automaticamente varias veces; vuelve a verificar para reintentar.`,
      })
    }
    return
  }

  const verifyReleaseIntentMatch = url.pathname.match(/^\/api\/release-intents\/([^/]+)\/verify$/)

  if (request.method === 'POST' && verifyReleaseIntentMatch) {
    const intentId = decodeURIComponent(verifyReleaseIntentMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    const initialStore = await readStore()
    const initialIntent = initialStore.releaseFeeIntents.find((item) => item.id === intentId)

    if (!initialIntent) {
      sendJson(response, 404, { error: 'Solicitud de liberacion no encontrada.' })
      return
    }

    await withOfferLock(initialIntent.offerId, async () => {
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

      if (offer.paymentHash) {
        sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), paymentHash: offer.paymentHash })
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

      const escrowAccount = await assignEscrowAccountToOffer(store, offer)
      if (intent.receiverAddress !== escrowAccount.account) {
        intent.status = 'EXPIRED'
        await writeStore(store)
        sendJson(response, 409, { error: 'Esta solicitud de deposito ya no corresponde a la cuenta temporal de la negociacion. Inicia una nueva.' })
        return
      }

      if (new Date(intent.expiresAt).getTime() <= Date.now()) {
        intent.status = 'EXPIRED'
        await writeStore(store)
        sendJson(response, 410, { error: 'La solicitud de liberacion vencio. Inicia una nueva.' })
        return
      }

      try {
        const payment = await findIncomingPaymentByAmount({
          receiverWallet: intent.receiverAddress,
          amountNano: intent.amountXno,
          createdAfter: intent.createdAt,
          excludedHashes: store.usedPayments.map((item) => item.hash),
        })

        intent.status = 'VERIFIED'
        intent.paymentHash = payment.hash
        intent.senderWallet = payment.senderWallet
        offer.sellerWallet = payment.senderWallet
        offer.paymentHash = payment.hash
        store.usedPayments.push({ hash: payment.hash, purpose: 'seller_deposit', createdAt: new Date().toISOString() })
        await writeStore(store)
        sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), paymentHash: payment.hash })
      } catch (error) {
        sendJson(response, 422, {
          error: error instanceof Error ? error.message : 'No se pudo validar el deposito.',
        })
      }
    })
    return
  }

  const confirmPaymentMatch = url.pathname.match(/^\/api\/offers\/([^/]+)\/confirm-payment$/)

  if (request.method === 'POST' && confirmPaymentMatch) {
    const offerId = decodeURIComponent(confirmPaymentMatch[1])
    const body = await readJsonBody(request)
    const clientSessionId = normalizeClientSessionId(body.clientSessionId)
    await withOfferLock(offerId, async () => {
      const store = await readStore()
      const offer = store.offers.find((item) => item.id === offerId)

      if (!offer) {
        sendJson(response, 404, { error: 'La oferta no existe.' })
        return
      }

      if (offer.status !== 'NEGOTIATION' && offer.status !== 'RELEASING') {
        sendJson(response, 409, { error: 'Esta oferta ya no esta en negociacion.' })
        return
      }

      if (!offer.sellerSessionId || offer.sellerSessionId !== clientSessionId) {
        sendJson(response, 403, { error: 'Solo la sesion vendedora que publico la oferta puede confirmar el pago.' })
        return
      }

      if (!offer.paymentHash) {
        sendJson(response, 409, { error: 'Primero confirma el deposito Nano en custodia.' })
        return
      }

      offer.status = 'RELEASING'
      offer.releaseRequestedAt = new Date().toISOString()
      try {
        const withdrawal = await releaseOfferFunds(store, offer)
        await writeStore(store)
        sendJson(response, 200, { offer: publicOffer(offer, { clientSessionId }), paymentHash: withdrawal.blockHash })
      } catch (error) {
        await writeStore(store)
        const message = error instanceof Error ? error.message : 'No se pudo liberar los fondos al comprador.'
        sendJson(response, 422, { error: `${message} Se intento varias veces; vuelve a confirmar para reintentar.` })
      }
    })
    return
  }

  sendJson(response, 404, { error: 'Ruta no encontrada.' })
}

const handleAdmin = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  const store = await readStore()
  const custodianSession = getAdminCustodianSession(store, request)

  if (!custodianSession) {
    await writeStore(store)
    redirectToCustodianAuth(response)
    return
  }

  await writeStore(store)

  if (request.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
    response.writeHead(303, { Location: '/admin/offers', ...corsHeaders })
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/admin/offers') {
    sendHtml(response, 200, renderAdmin(store.offers))
    return
  }

  if (request.method === 'GET' && url.pathname === '/admin/nano-accounts') {
    sendHtml(response, 200, renderNanoAccountsAdmin(store.nanoAccounts, getActiveCustodian(store).wallet, normalizeText(url.searchParams.get('message'))))
    return
  }

  if (request.method === 'POST' && url.pathname === '/admin/nano-accounts/generate') {
    const form = await readFormBody(request)

    try {
      const account = await createNanoAccountRecord({
        label: normalizeText(form.get('label')),
        purpose: 'ESCROW',
        notes: normalizeText(form.get('notes')),
      })
      store.nanoAccounts.unshift(account)
      await writeStore(store)
      response.writeHead(303, { Location: '/admin/nano-accounts?message=Cuenta%20Nano%20generada', ...corsHeaders })
      response.end()
    } catch (error) {
      sendJson(response, 422, { error: error instanceof Error ? error.message : 'No se pudo generar la cuenta Nano.' })
    }
    return
  }

  const nanoAccountUpdateMatch = url.pathname.match(/^\/admin\/nano-accounts\/([^/]+)\/update$/)

  if (request.method === 'POST' && nanoAccountUpdateMatch) {
    const accountId = decodeURIComponent(nanoAccountUpdateMatch[1])
    const form = await readFormBody(request)
    const status = String(form.get('status') ?? '')

    if (!nanoAccountStatuses.includes(status as NanoAccountStatus)) {
      sendJson(response, 400, { error: 'Estado de cuenta invalido.' })
      return
    }

    const commissionAvailableXno = normalizeText(form.get('commissionAvailableXno')).replace(',', '.')
    try {
      if (BigInt(nanoToRaw(commissionAvailableXno || '0')) < 0n) throw new Error('Monto invalido')
    } catch {
      sendJson(response, 400, { error: 'Comision disponible invalida.' })
      return
    }

    const account = store.nanoAccounts.find((item) => item.id === accountId)

    if (!account) {
      sendJson(response, 404, { error: 'Cuenta Nano no encontrada.' })
      return
    }

    account.status = status as NanoAccountStatus
    account.purpose = 'ESCROW'
    account.label = normalizeText(form.get('label')) || undefined
    account.linkedOfferId = normalizeText(form.get('linkedOfferId')) || undefined
    account.commissionAvailableXno = commissionAvailableXno || '0'
    account.notes = normalizeText(form.get('notes')) || undefined
    account.updatedAt = new Date().toISOString()
    if (account.status === 'ASSIGNED') account.lastUsedAt = account.lastUsedAt ?? account.updatedAt

    await writeStore(store)
    response.writeHead(303, { Location: '/admin/nano-accounts?message=Cuenta%20actualizada', ...corsHeaders })
    response.end()
    return
  }

  const nanoAccountWithdrawalMatch = url.pathname.match(/^\/admin\/nano-accounts\/([^/]+)\/withdraw$/)

  if (request.method === 'POST' && nanoAccountWithdrawalMatch) {
    const accountId = decodeURIComponent(nanoAccountWithdrawalMatch[1])
    const form = await readFormBody(request)
    const account = store.nanoAccounts.find((item) => item.id === accountId)
    const destination = normalizeText(form.get('destination'))

    if (!account) {
      sendJson(response, 404, { error: 'Cuenta Nano no encontrada.' })
      return
    }

    if (!isNanoAddress(destination)) {
      sendJson(response, 400, { error: 'Ingresa una wallet Nano destino valida.' })
      return
    }

    const amountXno = account.commissionAvailableXno.replace(',', '.')

    try {
      if (BigInt(nanoToRaw(amountXno)) <= 0n) throw new Error('Monto invalido')
    } catch {
      sendJson(response, 400, { error: 'La cuenta no tiene comision disponible para retirar.' })
      return
    }

    let withdrawal: Awaited<ReturnType<typeof sendFromPrivateKey>>

    try {
      withdrawal = await sendFromTemporaryAccountWithRetry({
        walletId: nanoWalletId,
        privateKey: decryptSecret(account.encryptedPrivateKey),
        sourceAccount: account.account,
        destinationAccount: destination,
        amountNano: amountXno,
      })
    } catch (error) {
      sendJson(response, 422, { error: error instanceof Error ? error.message : 'No se pudo retirar desde la cuenta Nano.' })
      return
    }

    account.withdrawalHistory.unshift({
      id: `wdr_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      amountXno,
      destination,
      txHash: withdrawal.blockHash,
      createdAt: new Date().toISOString(),
      note: withdrawal.receivedBlocks.length
        ? `Retiro real. Bloques recibidos antes del envio: ${withdrawal.receivedBlocks.join(', ')}`
        : 'Retiro real.',
    })
    account.updatedAt = new Date().toISOString()

    account.commissionAvailableXno = '0'
    account.status = account.status === 'ASSIGNED' ? 'LOCKED' : account.status

    await writeStore(store)
    response.writeHead(303, { Location: '/admin/nano-accounts?message=Retiro%20real%20enviado', ...corsHeaders })
    response.end()
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

  const deleteOfferMatch = url.pathname.match(/^\/admin\/offers\/([^/]+)\/delete$/)

  if (request.method === 'POST' && deleteOfferMatch) {
    const offerId = decodeURIComponent(deleteOfferMatch[1])
    const offerIndex = store.offers.findIndex((item) => item.id === offerId)

    if (offerIndex === -1) {
      sendJson(response, 404, { error: 'Oferta no encontrada.' })
      return
    }

    const offer = store.offers[offerIndex]

    if (offer.status !== 'CANCELLED' && offer.status !== 'RELEASED') {
      sendJson(response, 409, { error: 'Solo se pueden eliminar ofertas canceladas o liberadas.' })
      return
    }

    store.offers.splice(offerIndex, 1)
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

    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
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
