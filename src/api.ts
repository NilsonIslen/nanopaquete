const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8789/api`

export const nanopaqueteApiUrl =
  import.meta.env.VITE_NANOPAQUETE_API_URL?.trim() || defaultApiUrl

export type Currency = 'COP' | 'USD' | 'BTC' | 'EUR'
export type OfferStatus = 'ACTIVE' | 'NEGOTIATION' | 'RELEASING' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'

export type PublicOffer = {
  id: string
  amountXno: string
  currency: Currency
  price: string
  status: OfferStatus
  createdAt: string
}

export type SellerPaymentIntent = {
  intentId: string
  receiverAddress: string
  paymentUri: string
  expiresAt: string
  custodianContact: string
}

export type EscrowSession = {
  escrowId: string
  publishToken: string
  amountXno: string
  sellerWallet: string
  paymentHash: string
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
  clientSessionId: string
}

export type TakenOffer = {
  offer: PublicOffer
  sellerContact: string
  sellerCountry?: string
  sellerDialCode?: string
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

export const getOffers = () => requestJson<{ offers: PublicOffer[] }>('/offers')

export const getBuyerNegotiation = (clientSessionId: string) =>
  requestJson<{ negotiation: TakenOffer | null }>(
    `/buyer-negotiation?clientSessionId=${encodeURIComponent(clientSessionId)}`,
  )

export const startSellerPayment = (clientSessionId: string) =>
  requestJson<SellerPaymentIntent>('/seller-payments', {
    method: 'POST',
    body: JSON.stringify({ clientSessionId }),
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

export const startReleaseFee = (offerId: string) =>
  requestJson<ReleaseFeeIntent>(`/offers/${encodeURIComponent(offerId)}/release-intents`, {
    method: 'POST',
    body: JSON.stringify({}),
  })

export const verifyReleaseFee = (intentId: string) =>
  requestJson<{ offer: PublicOffer; paymentHash?: string }>(`/release-intents/${encodeURIComponent(intentId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
