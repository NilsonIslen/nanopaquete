import * as nanocurrency from 'nanocurrency'

const RAW_PER_NANO = 10n ** 30n
const RPC_TIMEOUT_MS = Number(process.env.NANO_RPC_TIMEOUT_MS ?? 8000)
const DEFAULT_NANO_RPC_URL = 'http://127.0.0.1:7076'
const rpcCooldowns = new Map<string, number>()

type RpcOptions = {
  shouldRetryWithFallback?: (data: Record<string, unknown>) => boolean
}

type IncomingPayment = {
  hash: string
  senderWallet: string
  amountNano: string
}

type GeneratedNanoAccount = {
  account: string
  publicKey: string
  privateKey: string
}

type NanoSendResult = {
  blockHash: string
  receivedBlocks: string[]
}

type HistoryEntry = Record<string, string | undefined>
type ReceivableEntry = { amount?: string; source?: string }

export const normalizeNanoHash = (value: string) => value.trim().toUpperCase()

export const isNanoHash = (value: string) => /^[A-F0-9]{64}$/.test(normalizeNanoHash(value))

export const isNanoAddress = (value: string) =>
  /^(nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(value.trim())

export const nanoToRaw = (value: string) => {
  const normalized = String(value).trim()

  if (!/^\d+(\.\d{1,30})?$/.test(normalized)) {
    throw new Error('El monto Nano no es valido')
  }

  const [whole = '0', fraction = ''] = normalized.split('.')
  return (BigInt(whole) * RAW_PER_NANO + BigInt(fraction.padEnd(30, '0'))).toString()
}

export const formatRawAsNano = (raw: string | undefined) => {
  if (!raw || !/^\d+$/.test(raw)) return 'desconocido'

  const value = BigInt(raw)
  const whole = value / RAW_PER_NANO
  const fraction = value % RAW_PER_NANO

  if (fraction === 0n) return whole.toString()

  return `${whole}.${fraction.toString().padStart(30, '0').replace(/0+$/, '')}`
}

const getPaymentAmountToleranceNano = () =>
  process.env.NANO_PAYMENT_AMOUNT_TOLERANCE?.trim() || '0.000001'

const getPaymentAmountToleranceRaw = () => {
  try {
    return BigInt(nanoToRaw(getPaymentAmountToleranceNano()))
  } catch {
    return BigInt(nanoToRaw('0.000001'))
  }
}

const getRawDifference = (left: string, right: string) => {
  const leftRaw = BigInt(left)
  const rightRaw = BigInt(right)
  return leftRaw > rightRaw ? leftRaw - rightRaw : rightRaw - leftRaw
}

const isAcceptedAmount = (actualRaw: string | undefined, expectedRaw: string) =>
  /^\d+$/.test(String(actualRaw ?? '')) &&
  getRawDifference(String(actualRaw), expectedRaw) <= getPaymentAmountToleranceRaw()

export async function findAnyIncomingPayment({
  receiverWallet,
  createdAfter,
  excludedHashes = [],
}: {
  receiverWallet: string
  createdAfter?: string
  excludedHashes?: string[]
}): Promise<IncomingPayment> {
  const minimumTimestampMs = createdAfter ? new Date(createdAfter).getTime() : undefined
  const excluded = new Set(excludedHashes.map(normalizeNanoHash))
  const isRecentEnough = (entry: Record<string, unknown>) => {
    if (!minimumTimestampMs) return true
    const timestamp = Number(entry.local_timestamp ?? entry.timestamp)

    if (!Number.isFinite(timestamp) || timestamp <= 0) return false

    return timestamp * 1000 >= minimumTimestampMs
  }
  const getReceivableMatch = (entries: Array<[string, ReceivableEntry]>) =>
    entries.find(
      ([hash, entry]) =>
        Boolean(entry.amount) &&
        Boolean(entry.source) &&
        isNanoHash(hash) &&
        !excluded.has(normalizeNanoHash(hash)),
    )

  const receivable = await nanoRpc(
    {
      action: 'receivable',
      account: receiverWallet,
      count: '100',
      source: 'true',
      include_only_confirmed: 'true',
    },
    {
      shouldRetryWithFallback: (data) => !getReceivableMatch(getReceivableEntries(data)),
    },
  )

  const pendingPayment = getReceivableMatch(getReceivableEntries(receivable))

  if (pendingPayment) {
    const [hash, entry] = pendingPayment
    const block = await getNanoBlockInfo(hash)
    if (isRecentEnough(block)) {
      const issue = getIncomingPaymentIssue(block, {
        senderWallet: entry.source ?? '',
        receiverWallet,
      })

      if (issue) throw new Error(issue)

      return {
        hash: normalizeNanoHash(hash),
        senderWallet: entry.source ?? '',
        amountNano: formatRawAsNano(entry.amount),
      }
    }
  }

  const data = await nanoRpc(
    {
      action: 'account_history',
      account: receiverWallet,
      count: '100',
      raw: 'true',
    },
    {
      shouldRetryWithFallback: (history) => !Array.isArray(history.history) || !getReceiveMatch(history.history),
    },
  )

  if (!Array.isArray(data.history)) {
    throw new Error('No encontre movimientos recientes en la cuenta de custodia.')
  }

  const payment = getReceiveMatch(data.history)

  if (!payment?.hash || !payment.account || !payment.amount) {
    throw new Error('El deposito aun no aparece confirmado. Espera unos segundos y vuelve a verificar.')
  }

  return {
    hash: normalizeNanoHash(payment.hash),
    senderWallet: payment.account,
    amountNano: formatRawAsNano(payment.amount),
  }

  function getReceiveMatch(history: HistoryEntry[]) {
    return history.find(
      (entry) =>
        getBlockType(entry) === 'receive' &&
        entry.confirmed === 'true' &&
        Boolean(entry.amount) &&
        Boolean(entry.hash) &&
        Boolean(entry.account) &&
        isNanoHash(entry.hash ?? '') &&
        isRecentEnough(entry) &&
        !excluded.has(normalizeNanoHash(entry.hash ?? '')),
    )
  }
}

export async function findIncomingPaymentBySenderAmount({
  receiverWallet,
  senderWallet,
  amountNano,
  createdAfter,
  excludedHashes = [],
}: {
  receiverWallet: string
  senderWallet: string
  amountNano: string
  createdAfter?: string
  excludedHashes?: string[]
}): Promise<IncomingPayment> {
  const expectedRaw = nanoToRaw(amountNano)
  const minimumTimestampMs = createdAfter ? new Date(createdAfter).getTime() : undefined
  const excluded = new Set(excludedHashes.map(normalizeNanoHash))
  const isRecentEnough = (entry: Record<string, unknown>) => {
    if (!minimumTimestampMs) return true
    const timestamp = Number(entry.local_timestamp ?? entry.timestamp)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false
    return timestamp * 1000 >= minimumTimestampMs
  }
  const getReceivableMatch = (entries: Array<[string, ReceivableEntry]>) =>
    entries.find(
      ([hash, entry]) =>
        entry.source === senderWallet &&
        isAcceptedAmount(entry.amount, expectedRaw) &&
        isNanoHash(hash) &&
        !excluded.has(normalizeNanoHash(hash)),
    )

  const receivable = await nanoRpc(
    {
      action: 'receivable',
      account: receiverWallet,
      count: '100',
      source: 'true',
      include_only_confirmed: 'true',
    },
    { shouldRetryWithFallback: (data) => !getReceivableMatch(getReceivableEntries(data)) },
  )
  const pendingPayment = getReceivableMatch(getReceivableEntries(receivable))

  if (pendingPayment) {
    const [hash, entry] = pendingPayment
    const block = await getNanoBlockInfo(hash)
    if (isRecentEnough(block)) {
      const issue = getIncomingPaymentIssue(block, { senderWallet, receiverWallet })
      if (issue) throw new Error(issue)
      return {
        hash: normalizeNanoHash(hash),
        senderWallet,
        amountNano: formatRawAsNano(entry.amount),
      }
    }
  }

  const data = await nanoRpc(
    {
      action: 'account_history',
      account: receiverWallet,
      count: '100',
      raw: 'true',
    },
    { shouldRetryWithFallback: (history) => !Array.isArray(history.history) || !getReceiveMatch(history.history) },
  )

  if (!Array.isArray(data.history)) {
    throw new Error('No encontre movimientos recientes en la cuenta de custodia.')
  }

  const payment = getReceiveMatch(data.history)
  if (!payment?.hash || !payment.account || !payment.amount) {
    throw new Error(`No encontre un pago confirmado de ${amountNano} XNO desde la wallet vendedora hacia la custodia.`)
  }

  return {
    hash: normalizeNanoHash(payment.hash),
    senderWallet: payment.account,
    amountNano: formatRawAsNano(payment.amount),
  }

  function getReceiveMatch(history: HistoryEntry[]) {
    return history.find(
      (entry) =>
        getBlockType(entry) === 'receive' &&
        entry.confirmed === 'true' &&
        entry.account === senderWallet &&
        isAcceptedAmount(entry.amount, expectedRaw) &&
        Boolean(entry.hash) &&
        isNanoHash(entry.hash ?? '') &&
        isRecentEnough(entry) &&
        !excluded.has(normalizeNanoHash(entry.hash ?? '')),
    )
  }
}

export async function findIncomingPaymentByAmount({
  receiverWallet,
  amountNano,
  createdAfter,
  excludedHashes = [],
}: {
  receiverWallet: string
  amountNano: string
  createdAfter?: string
  excludedHashes?: string[]
}): Promise<IncomingPayment> {
  const expectedRaw = nanoToRaw(amountNano)
  const minimumTimestampMs = createdAfter ? new Date(createdAfter).getTime() : undefined
  const excluded = new Set(excludedHashes.map(normalizeNanoHash))
  const isRecentEnough = (entry: Record<string, unknown>) => {
    if (!minimumTimestampMs) return true
    const timestamp = Number(entry.local_timestamp ?? entry.timestamp)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false
    return timestamp * 1000 >= minimumTimestampMs
  }
  const getReceivableMatch = (entries: Array<[string, ReceivableEntry]>) =>
    entries.find(
      ([hash, entry]) =>
        Boolean(entry.source) &&
        isAcceptedAmount(entry.amount, expectedRaw) &&
        isNanoHash(hash) &&
        !excluded.has(normalizeNanoHash(hash)),
    )

  const receivable = await nanoRpc(
    {
      action: 'receivable',
      account: receiverWallet,
      count: '100',
      source: 'true',
      include_only_confirmed: 'true',
    },
    { shouldRetryWithFallback: (data) => !getReceivableMatch(getReceivableEntries(data)) },
  )
  const pendingPayment = getReceivableMatch(getReceivableEntries(receivable))

  if (pendingPayment) {
    const [hash, entry] = pendingPayment
    const block = await getNanoBlockInfo(hash)
    if (isRecentEnough(block)) {
      const senderWallet = entry.source ?? ''
      const issue = getIncomingPaymentIssue(block, { senderWallet, receiverWallet })
      if (issue) throw new Error(issue)
      return {
        hash: normalizeNanoHash(hash),
        senderWallet,
        amountNano: formatRawAsNano(entry.amount),
      }
    }
  }

  const data = await nanoRpc(
    {
      action: 'account_history',
      account: receiverWallet,
      count: '100',
      raw: 'true',
    },
    { shouldRetryWithFallback: (history) => !Array.isArray(history.history) || !getReceiveMatch(history.history) },
  )

  if (!Array.isArray(data.history)) {
    throw new Error('No encontre movimientos recientes en la cuenta de custodia.')
  }

  const payment = getReceiveMatch(data.history)
  if (!payment?.hash || !payment.account || !payment.amount) {
    throw new Error(`No encontre un pago confirmado de ${amountNano} XNO hacia el custodio lider asignado.`)
  }

  return {
    hash: normalizeNanoHash(payment.hash),
    senderWallet: payment.account,
    amountNano: formatRawAsNano(payment.amount),
  }

  function getReceiveMatch(history: HistoryEntry[]) {
    return history.find(
      (entry) =>
        getBlockType(entry) === 'receive' &&
        entry.confirmed === 'true' &&
        Boolean(entry.account) &&
        isAcceptedAmount(entry.amount, expectedRaw) &&
        Boolean(entry.hash) &&
        isNanoHash(entry.hash ?? '') &&
        isRecentEnough(entry) &&
        !excluded.has(normalizeNanoHash(entry.hash ?? '')),
    )
  }
}

export async function createNanoAccount(): Promise<GeneratedNanoAccount> {
  const seed = await nanocurrency.generateSeed()
  const privateKey = nanocurrency.deriveSecretKey(seed, 0)
  const publicKey = nanocurrency.derivePublicKey(privateKey)
  const account = nanocurrency.deriveAddress(publicKey, { useNanoPrefix: true })

  if (!isNanoAddress(account) || !/^[A-Fa-f0-9]{64}$/.test(publicKey) || !/^[A-Fa-f0-9]{64}$/.test(privateKey)) {
    throw new Error('No se pudo generar una cuenta Nano valida.')
  }

  return {
    account,
    publicKey: publicKey.toUpperCase(),
    privateKey: privateKey.toUpperCase(),
  }
}

export async function sendFromPrivateKey({
  walletId,
  privateKey,
  sourceAccount,
  destinationAccount,
  amountNano,
}: {
  walletId: string
  privateKey: string
  sourceAccount: string
  destinationAccount: string
  amountNano: string
}): Promise<NanoSendResult> {
  if (!isNanoAddress(sourceAccount)) throw new Error('La cuenta Nano de origen no es valida.')
  if (!isNanoAddress(destinationAccount)) throw new Error('La cuenta Nano destino no es valida.')

  if (!walletId.trim()) {
    return sendFromPrivateKeyStateless({ privateKey, sourceAccount, destinationAccount, amountNano })
  }

  await importPrivateKey(walletId, privateKey, sourceAccount)
  const receivedBlocks = await receivePendingBlocks(walletId, sourceAccount)
  const sent = await nanoRpc({
    action: 'send',
    wallet: walletId,
    source: sourceAccount,
    destination: destinationAccount,
    amount: nanoToRaw(amountNano),
  })
  const blockHash = String(sent.block ?? '').toUpperCase()

  if (!isNanoHash(blockHash)) {
    throw new Error('El nodo Nano no devolvio un hash valido para el retiro.')
  }

  return { blockHash, receivedBlocks }
}

async function sendFromPrivateKeyStateless({
  privateKey,
  sourceAccount,
  destinationAccount,
  amountNano,
}: {
  privateKey: string
  sourceAccount: string
  destinationAccount: string
  amountNano: string
}): Promise<NanoSendResult> {
  const publicKey = nanocurrency.derivePublicKey(privateKey)
  const derivedAccount = nanocurrency.deriveAddress(publicKey, { useNanoPrefix: true })
  if (derivedAccount !== sourceAccount) throw new Error('La clave privada no corresponde a la cuenta Nano seleccionada.')

  const receivedBlocks: string[] = []
  const representativeFallback = sourceAccount
  const accountInfo = await getAccountInfo(sourceAccount)
  let frontier = accountInfo.frontier
  let balanceRaw = accountInfo.balanceRaw
  const representative = accountInfo.representative || representativeFallback

  const receivable = await nanoRpc({
    action: 'receivable',
    account: sourceAccount,
    count: '100',
    source: 'true',
    include_only_confirmed: 'true',
  })

  for (const [hash, entry] of getReceivableEntries(receivable)) {
    if (!isNanoHash(hash) || !entry.amount) continue
    const subtype = frontier ? 'receive' : 'open'
    const nextBalanceRaw = (balanceRaw + BigInt(entry.amount)).toString()
    const work = await getWork(frontier ?? publicKey)
    const receive = nanocurrency.createBlock(privateKey, {
      work,
      representative,
      balance: nextBalanceRaw,
      previous: frontier,
      link: normalizeNanoHash(hash),
    })
    const receivedHash = await processStateBlock(receive.block, subtype)
    receivedBlocks.push(receivedHash)
    frontier = receivedHash
    balanceRaw = BigInt(nextBalanceRaw)
  }

  const amountRaw = BigInt(nanoToRaw(amountNano))
  if (balanceRaw < amountRaw) throw new Error('La cuenta temporal no tiene saldo suficiente para liberar los fondos.')
  if (!frontier) throw new Error('La cuenta temporal no tiene un bloque abierto para enviar fondos.')

  const work = await getWork(frontier)
  const send = nanocurrency.createBlock(privateKey, {
    work,
    representative,
    balance: (balanceRaw - amountRaw).toString(),
    previous: frontier,
    link: destinationAccount,
  })
  const blockHash = await processStateBlock(send.block, 'send')

  return { blockHash, receivedBlocks }
}

async function importPrivateKey(walletId: string, privateKey: string, expectedAccount: string) {
  let data: Record<string, unknown>

  try {
    data = await nanoRpc({
      action: 'wallet_add',
      wallet: walletId,
      key: privateKey,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('already') || message.includes('exists')) return
    throw error
  }

  const account = String(data.account ?? '')

  if (account && account !== expectedAccount) {
    throw new Error('La clave privada no corresponde a la cuenta Nano seleccionada.')
  }
}

async function getAccountInfo(account: string) {
  try {
    const data = await nanoRpc({
      action: 'account_info',
      account,
      representative: 'true',
    })

    return {
      frontier: isNanoHash(String(data.frontier ?? '')) ? normalizeNanoHash(String(data.frontier)) : null,
      balanceRaw: /^\d+$/.test(String(data.balance ?? '')) ? BigInt(String(data.balance)) : 0n,
      representative: isNanoAddress(String(data.representative ?? '')) ? String(data.representative) : '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('account not found') || message.includes('not found')) {
      return { frontier: null, balanceRaw: 0n, representative: '' }
    }

    throw error
  }
}

async function getWork(hashOrPublicKey: string) {
  try {
    const data = await nanoRpc({
      action: 'work_generate',
      hash: hashOrPublicKey,
    })
    const work = String(data.work ?? '')
    if (nanocurrency.checkWork(work)) return work
  } catch {
    // Fall through to local work generation.
  }

  const work = await nanocurrency.computeWork(hashOrPublicKey)
  if (!work) throw new Error('No se pudo generar work para publicar la transferencia Nano.')
  return work
}

async function processStateBlock(block: Record<string, string>, subtype: 'open' | 'receive' | 'send') {
  const data = await nanoRpc({
    action: 'process',
    json_block: 'true',
    subtype,
    block,
  })
  const blockHash = String(data.hash ?? '').toUpperCase()
  if (!isNanoHash(blockHash)) throw new Error('El nodo Nano no devolvio un hash valido para el envio.')
  return blockHash
}

async function receivePendingBlocks(walletId: string, account: string) {
  const data = await nanoRpc({
    action: 'receivable',
    account,
    count: '100',
    source: 'true',
    include_only_confirmed: 'true',
  })
  const receivedBlocks: string[] = []

  for (const [hash] of getReceivableEntries(data)) {
    if (!isNanoHash(hash)) continue
    const received = await nanoRpc({
      action: 'receive',
      wallet: walletId,
      account,
      block: normalizeNanoHash(hash),
    })
    const receivedHash = String(received.block ?? '').toUpperCase()
    if (isNanoHash(receivedHash)) receivedBlocks.push(receivedHash)
  }

  return receivedBlocks
}

async function getNanoBlockInfo(hash: string) {
  const data = await nanoRpc({
    action: 'block_info',
    hash: normalizeNanoHash(hash),
    json_block: 'true',
  })

  return normalizeBlockInfo(data)
}

function getIncomingPaymentIssue(
  block: Record<string, unknown>,
  { senderWallet, receiverWallet }: { senderWallet: string; receiverWallet: string },
) {
  if (block.confirmed !== 'true') {
    return 'La transaccion todavia no esta confirmada en la red Nano.'
  }

  if (getBlockType(block) !== 'send') {
    return 'La transaccion encontrada no es un bloque de envio.'
  }

  if (block.block_account !== senderWallet) {
    return 'El deposito no fue enviado desde la wallet reportada por la red.'
  }

  if (getLinkAsAccount(block) !== receiverWallet) {
    return 'El deposito no fue enviado a la wallet de custodia esperada.'
  }

  return null
}

async function nanoRpc(body: Record<string, unknown>, options: RpcOptions = {}) {
  const rpcUrls = getNanoRpcUrls()
  let lastError: unknown

  for (let index = 0; index < rpcUrls.length; index += 1) {
    const isLastRpc = index === rpcUrls.length - 1
    const cooldownUntil = rpcCooldowns.get(rpcUrls[index]) ?? 0

    if (cooldownUntil > Date.now()) {
      lastError = new Error('El servicio de respaldo esta recuperandose')
      continue
    }

    try {
      const data = await requestNanoRpc(rpcUrls[index], body)

      if (!isLastRpc && options.shouldRetryWithFallback?.(data)) continue

      return data
    } catch (error) {
      lastError = error
      if (isLastRpc) break
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No se pudo conectar con ningun nodo Nano')
}

async function requestNanoRpc(rpcUrl: string, body: Record<string, unknown>) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`El nodo Nano respondio con estado ${response.status}`)
    }

    const data = (await response.json()) as Record<string, unknown>

    if (data.error) {
      const retryAfter = Number(data.retry_after)

      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const nowSeconds = Date.now() / 1000
        const retrySeconds = retryAfter > nowSeconds ? retryAfter - nowSeconds : retryAfter
        const cooldownSeconds = Math.min(Math.max(retrySeconds, 1), 30)
        rpcCooldowns.set(rpcUrl, Date.now() + cooldownSeconds * 1000)
      }

      throw new Error(String(data.message || data.error))
    }

    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('El nodo Nano tardo demasiado en responder', { cause: error })
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getNanoRpcUrls() {
  return [
    process.env.NANO_RPC_URL ?? DEFAULT_NANO_RPC_URL,
    ...(process.env.NANO_RPC_FALLBACK_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
  ]
}

function normalizeBlockInfo(block: Record<string, unknown>) {
  if (typeof block.contents !== 'string') return block

  try {
    return { ...block, contents: JSON.parse(block.contents) as Record<string, unknown> }
  } catch {
    return block
  }
}

function getLinkAsAccount(block: Record<string, unknown>) {
  if (!block.contents || typeof block.contents === 'string') return undefined
  return (block.contents as Record<string, unknown>).link_as_account
}

function getBlockType(block: Record<string, unknown>) {
  return block.subtype ?? block.type
}

function getReceivableEntries(data: Record<string, unknown>) {
  if (!data.blocks || typeof data.blocks !== 'object') return []
  return Object.entries(data.blocks as Record<string, ReceivableEntry>)
}
