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
