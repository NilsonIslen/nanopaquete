const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:8789/api`

export const nanopaqueteApiUrl =
  import.meta.env.VITE_NANOPAQUETE_API_URL?.trim() || defaultApiUrl

export type Currency = 'COP' | 'USD' | 'BTC' | 'EUR'
export type OfferStatus = 'ACTIVE' | 'NEGOTIATION' | 'RELEASED' | 'CANCELLED' | 'DISPUTED'

export type PublicOffer = {
  id: string
  amountXno: string
  currency: Currency
  price: string
  status: OfferStatus
  createdAt: string
}

export type EscrowRegistration = {
  amountXno: string
  sellerWallet?: string
  transferReference?: string
}

export type EscrowSession = {
  escrowId: string
  publishToken: string
  custodianContact: string
  escrowWallet: string
  custodyFeeXno: string
}

export type PublishOfferPayload = {
  escrowId: string
  publishToken: string
  currency: Currency
  price: string
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
}

export type TakenOffer = {
  offer: PublicOffer
  sellerContact: string
  buyerCancelCode: string
  custodianContact: string
  custodyFeeXno: string
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

export const registerEscrow = (payload: EscrowRegistration) =>
  requestJson<EscrowSession>('/escrows', {
    method: 'POST',
    body: JSON.stringify(payload),
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
