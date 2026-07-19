const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8789/api`

export const nanopaqueteApiUrl =
  import.meta.env.VITE_NANOPAQUETE_API_URL?.trim() || defaultApiUrl

export type Currency =
  | 'ARS'
  | 'BOB'
  | 'BRL'
  | 'CLP'
  | 'COP'
  | 'CRC'
  | 'CUP'
  | 'DOP'
  | 'EUR'
  | 'GTQ'
  | 'HNL'
  | 'HTG'
  | 'BTC'
  | 'ETH'
  | 'USDT'
  | 'USDC'
  | 'BNB'
  | 'SOL'
  | 'XRP'
  | 'ADA'
  | 'DOGE'
  | 'TRX'
  | 'MXN'
  | 'NIO'
  | 'PYG'
  | 'PEN'
  | 'USD'
  | 'UYU'
  | 'VES'
export type OfferStatus = 'ACTIVE' | 'QUEUED' | 'NEGOTIATION' | 'RELEASING' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'
export type OfferType = 'SELL' | 'BUY'

export type CustodianOption = {
  id: string
  name: string
  contact: string
  country?: string
  dialCode?: string
  wallet?: string
  isLeader?: boolean
  role?: 'ADMIN' | 'CONCILIATOR'
}

export type ManagedCustodian = CustodianOption & {
  wallet: string
  isLeader?: boolean
  role?: 'ADMIN' | 'CONCILIATOR'
}

export type PublicOffer = {
  id: string
  offerType: OfferType
  amountXno: string
  currency: Currency
  price: string
  paymentMethods?: string
  status: OfferStatus
  createdAt: string
  isOwnOffer?: boolean
  isPublishedOffer?: boolean
  canEditPrice?: boolean
  canDeleteOffer?: boolean
  canDepositNano?: boolean
  canConfirmPayment?: boolean
  canCancelTake?: boolean
  canCustodianReleaseOffer?: boolean
  canCustodianReleaseFunds?: boolean
  sellerDepositConfirmed?: boolean
  sellerCountry?: string
  sellerDialCode?: string
  sellerContact?: string
  buyerCountry?: string
  buyerDialCode?: string
  buyerContact?: string
  queueReason?: string
  canUseChat?: boolean
}

export type SellerPaymentIntent = {
  intentId: string
  receiverAddress: string
  amountXno: string
  paymentUri: string
  expiresAt: string
  custodianId: string
  custodianName: string
}

export type EscrowSession = {
  escrowId: string
  publishToken: string
  amountXno: string
  sellerWallet: string
  paymentHash: string
  custodianId: string
  custodianName: string
  escrowWallet: string
  custodyFeeXno: string
}

export type PublishOfferPayload = {
  amountXno: string
  currency: Currency
  price: string
  paymentMethods: string
  custodianId: string
  clientSessionId: string
}

export type PublishBuyOfferPayload = {
  amountXno: string
  currency: Currency
  price: string
  buyerNanoAddress: string
  paymentMethods: string
  clientSessionId: string
}

export type PublishedOffer = {
  offer: PublicOffer
  sellerPrivateCode: string
  custodyFeeXno: string
}

export type TakeOfferPayload = {
  buyerNanoAddress?: string
  clientSessionId: string
}

export type TakenOffer = {
  offer: PublicOffer
  paymentMethods?: string
  sellerContact?: string
  sellerCountry?: string
  sellerDialCode?: string
  buyerContact?: string
  buyerCountry?: string
  buyerDialCode?: string
}

export type ChatMessage = {
  id: string
  offerId: string
  senderRole: 'seller' | 'buyer'
  senderLabel: string
  body: string
  createdAt: string
}

export type CustodianAuthIntent = {
  id: string
  leaderCustodianId: string
  receiverAddress: string
  amountXno: string
  paymentUri: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  createdAt: string
  expiresAt: string
}

export type CustodianSession = {
  sessionId: string
  expiresAt: string
  custodianId: string
  custodianName: string
  isLeader?: boolean
  role?: 'ADMIN' | 'CONCILIATOR'
}

export type ReleaseFeeIntent = {
  id: string
  offerId: string
  senderWallet: string
  receiverAddress: string
  amountXno: string
  paymentUri: string
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED'
  createdAt: string
  expiresAt: string
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${nanopaqueteApiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    })
  } catch {
    throw new Error(`No se pudo conectar con el backend: ${nanopaqueteApiUrl}`)
  }

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'La solicitud no pudo completarse')
  }

  return data as T
}

export const getCustodians = () => requestJson<{ custodians: CustodianOption[] }>('/custodians')

export const getOffers = (clientSessionId: string, custodianSessionId?: string) => {
  const params = new URLSearchParams({ clientSessionId })
  if (custodianSessionId) params.set('custodianSessionId', custodianSessionId)
  return requestJson<{ offers: PublicOffer[] }>(`/offers?${params.toString()}`)
}

export const getBuyerNegotiation = (clientSessionId: string) =>
  requestJson<{ negotiation: TakenOffer | null }>(
    `/buyer-negotiation?clientSessionId=${encodeURIComponent(clientSessionId)}`,
  )

export const startSellerPayment = (clientSessionId: string, custodianId: string, amountXno: string) =>
  requestJson<SellerPaymentIntent>('/seller-payments', {
    method: 'POST',
    body: JSON.stringify({ clientSessionId, custodianId, amountXno }),
  })

export const verifySellerPayment = (intentId: string, clientSessionId: string) =>
  requestJson<EscrowSession>(`/seller-payments/${encodeURIComponent(intentId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
  })

export const publishOffer = (payload: PublishOfferPayload) =>
  requestJson<PublishedOffer>('/offers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const publishBuyOffer = (payload: PublishBuyOfferPayload) =>
  requestJson<PublishedOffer>('/buy-offers', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const updateOfferPrice = (offerId: string, payload: { price: string; clientSessionId: string }) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}/price`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const deleteOffer = (offerId: string, clientSessionId: string) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ clientSessionId }),
  })

export const takeOffer = (offerId: string, payload: TakeOfferPayload) =>
  requestJson<TakenOffer>(`/offers/${encodeURIComponent(offerId)}/take`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const cancelTakenOffer = (offerId: string, clientSessionId: string) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}/cancel-take`, {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
  })

export const releaseExpiredTakenOffer = (offerId: string, custodianSessionId: string) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}/release-expired-take`, {
    method: 'POST',
    body: JSON.stringify({ custodianSessionId }),
  })

export const startReleaseFee = (offerId: string, clientSessionId: string) =>
  requestJson<ReleaseFeeIntent>(`/offers/${encodeURIComponent(offerId)}/release-intents`, {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
  })

export const verifyReleaseFee = (intentId: string, clientSessionId: string) =>
  requestJson<{ offer: PublicOffer; paymentHash?: string }>(`/release-intents/${encodeURIComponent(intentId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
  })

export const confirmSellerPayment = (offerId: string, clientSessionId: string) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}/confirm-payment`, {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
  })

export const startCustodianAuth = () =>
  requestJson<CustodianAuthIntent>('/custodian-auth', {
    method: 'POST',
    body: JSON.stringify({}),
  })

export const verifyCustodianAuth = (intentId: string) =>
  requestJson<CustodianSession>(`/custodian-auth/${encodeURIComponent(intentId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  })

export const logoutCustodianAuth = (custodianSessionId: string) =>
  requestJson<{ ok: boolean }>('/custodian-auth/logout', {
    method: 'POST',
    body: JSON.stringify({ custodianSessionId }),
  })

export const getManagedCustodians = (custodianSessionId: string) =>
  requestJson<{ custodians: ManagedCustodian[]; canManage: boolean }>(
    `/custodian-admin/custodians?custodianSessionId=${encodeURIComponent(custodianSessionId)}`,
  )

export const addManagedCustodian = (payload: { custodianSessionId: string; wallet: string; role: 'ADMIN' | 'CONCILIATOR' }) =>
  requestJson<{ custodian: ManagedCustodian; custodians: ManagedCustodian[] }>(
    '/custodian-admin/custodians',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )

export const deleteManagedCustodian = (custodianId: string, custodianSessionId: string) =>
  requestJson<{ custodians: ManagedCustodian[] }>(
    `/custodian-admin/custodians/${encodeURIComponent(custodianId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ custodianSessionId }),
    },
  )

export const verifyCustodianRelease = (offerId: string, custodianSessionId: string) =>
  requestJson<{ offer: PublicOffer; paymentHash?: string }>(`/offers/${encodeURIComponent(offerId)}/verify-custodian-release`, {
    method: 'POST',
    body: JSON.stringify({ custodianSessionId }),
  })

export const getOfferChat = (offerId: string, clientSessionId: string) =>
  requestJson<{ messages: ChatMessage[] }>(
    `/offers/${encodeURIComponent(offerId)}/chat?clientSessionId=${encodeURIComponent(clientSessionId)}`,
  )

export const sendOfferChatMessage = (offerId: string, payload: { clientSessionId: string; body: string }) =>
  requestJson<{ message: ChatMessage; messages: ChatMessage[] }>(`/offers/${encodeURIComponent(offerId)}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
