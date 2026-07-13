const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8789/api`

export const nanopaqueteApiUrl =
  import.meta.env.VITE_NANOPAQUETE_API_URL?.trim() || defaultApiUrl

export type Currency = 'COP' | 'USD' | 'BTC' | 'EUR'
export type OfferStatus = 'ACTIVE' | 'NEGOTIATION' | 'RELEASING' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'

export type CustodianOption = {
  id: string
  name: string
  contact: string
}

export type ManagedCustodian = CustodianOption & {
  wallet: string
  isLeader?: boolean
}

export type PublicOffer = {
  id: string
  amountXno: string
  currency: Currency
  price: string
  status: OfferStatus
  createdAt: string
  isOwnOffer?: boolean
  canEditPrice?: boolean
  canConfirmPayment?: boolean
  canCustodianReleaseOffer?: boolean
  sellerCountry?: string
  sellerDialCode?: string
  sellerContact?: string
  buyerCountry?: string
  buyerDialCode?: string
  buyerContact?: string
  custodianReleaseUri?: string
}

export type SellerPaymentIntent = {
  intentId: string
  receiverAddress: string
  paymentUri: string
  expiresAt: string
  custodianId: string
  custodianName: string
  custodianContact: string
}

export type EscrowSession = {
  escrowId: string
  publishToken: string
  amountXno: string
  sellerWallet: string
  paymentHash: string
  custodianId: string
  custodianName: string
  custodianContact: string
  escrowWallet: string
  custodyFeeXno: string
}

export type PublishOfferPayload = {
  escrowId: string
  publishToken: string
  currency: Currency
  price: string
  sellerCountry: string
  sellerDialCode: string
  sellerContact: string
}

export type PublishedOffer = {
  offer: PublicOffer
  sellerPrivateCode: string
  custodianContact: string
  custodyFeeXno: string
}

export type TakeOfferPayload = {
  buyerNanoAddress: string
  buyerCountry: string
  buyerDialCode: string
  buyerContact: string
  clientSessionId: string
}

export type TakenOffer = {
  offer: PublicOffer
  sellerContact: string
  sellerCountry?: string
  sellerDialCode?: string
  custodianContact: string
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

export const startSellerPayment = (clientSessionId: string, custodianId: string) =>
  requestJson<SellerPaymentIntent>('/seller-payments', {
    method: 'POST',
    body: JSON.stringify({ clientSessionId, custodianId }),
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

export const updateOfferPrice = (offerId: string, payload: { price: string; clientSessionId: string }) =>
  requestJson<{ offer: PublicOffer }>(`/offers/${encodeURIComponent(offerId)}/price`, {
    method: 'POST',
    body: JSON.stringify(payload),
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

export const getManagedCustodians = (custodianSessionId: string) =>
  requestJson<{ custodians: ManagedCustodian[]; canManage: boolean }>(
    `/custodian-admin/custodians?custodianSessionId=${encodeURIComponent(custodianSessionId)}`,
  )

export const addManagedCustodian = (payload: { custodianSessionId: string; name: string; wallet: string; contact: string; isLeader: boolean }) =>
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

export const updateManagedCustodianLeader = (custodianId: string, custodianSessionId: string, isLeader: boolean) =>
  requestJson<{ custodians: ManagedCustodian[] }>(
    `/custodian-admin/custodians/${encodeURIComponent(custodianId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ custodianSessionId, isLeader }),
    },
  )

export const verifyCustodianRelease = (offerId: string, custodianSessionId: string) =>
  requestJson<{ offer: PublicOffer; paymentHash?: string }>(`/offers/${encodeURIComponent(offerId)}/verify-custodian-release`, {
    method: 'POST',
    body: JSON.stringify({ custodianSessionId }),
  })
