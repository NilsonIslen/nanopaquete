import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, Download, Menu, Send, ShieldCheck, Wallet, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  addManagedCustodian,
  cancelTakenOffer,
  confirmSellerPayment,
  deleteOffer,
  deleteManagedCustodian,
  getManagedCustodians,
  getOfferChat,
  getBuyerNegotiation,
  getCustodians,
  getOffers,
  logoutCustodianAuth,
  publishBuyOffer,
  publishOffer,
  releaseExpiredTakenOffer,
  startCustodianAuth,
  startReleaseFee,
  sendOfferChatMessage,
  takeOffer,
  updateOfferPrice,
  verifyCustodianAuth,
  verifyCustodianRelease,
  verifyReleaseFee,
  type Currency,
  type CustodianAuthIntent,
  type CustodianOption,
  type CustodianSession,
  type PublicOffer,
  type ReleaseFeeIntent,
  type TakenOffer,
  type ChatMessage,
  type ManagedCustodian,
} from './api'
import './Nanopaquete.css'

const currencies: Currency[] = [
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
]

const currencyDetails: Record<Currency, { label: string; group: string; isCrypto?: boolean }> = {
  ARS: { label: 'Peso argentino', group: 'Argentina' },
  BOB: { label: 'Boliviano', group: 'Bolivia' },
  BRL: { label: 'Real brasileno', group: 'Brasil' },
  CLP: { label: 'Peso chileno', group: 'Chile' },
  COP: { label: 'Peso colombiano', group: 'Colombia' },
  CRC: { label: 'Colon costarricense', group: 'Costa Rica' },
  CUP: { label: 'Peso cubano', group: 'Cuba' },
  DOP: { label: 'Peso dominicano', group: 'Republica Dominicana' },
  EUR: { label: 'Euro', group: 'Espana' },
  GTQ: { label: 'Quetzal guatemalteco', group: 'Guatemala' },
  HNL: { label: 'Lempira hondureno', group: 'Honduras' },
  HTG: { label: 'Gourde haitiano', group: 'Haiti' },
  BTC: { label: 'Bitcoin', group: 'Global', isCrypto: true },
  ETH: { label: 'Ethereum', group: 'Global', isCrypto: true },
  USDT: { label: 'Tether', group: 'Global', isCrypto: true },
  USDC: { label: 'USD Coin', group: 'Global', isCrypto: true },
  BNB: { label: 'BNB', group: 'Global', isCrypto: true },
  SOL: { label: 'Solana', group: 'Global', isCrypto: true },
  XRP: { label: 'XRP', group: 'Global', isCrypto: true },
  ADA: { label: 'Cardano', group: 'Global', isCrypto: true },
  DOGE: { label: 'Dogecoin', group: 'Global', isCrypto: true },
  TRX: { label: 'TRON', group: 'Global', isCrypto: true },
  MXN: { label: 'Peso mexicano', group: 'Mexico' },
  NIO: { label: 'Cordoba nicaraguense', group: 'Nicaragua' },
  PYG: { label: 'Guarani paraguayo', group: 'Paraguay' },
  PEN: { label: 'Sol peruano', group: 'Peru' },
  USD: { label: 'Dolar estadounidense', group: 'El Salvador, Ecuador y Panama' },
  UYU: { label: 'Peso uruguayo', group: 'Uruguay' },
  VES: { label: 'Bolivar venezolano', group: 'Venezuela' },
}

const getCurrencyLabel = (currency: Currency) => `${currency} - ${currencyDetails[currency].label}`
const getOfferGroupTitle = (currency: Currency) => {
  const details = currencyDetails[currency]
  return details.isCrypto ? 'Global' : `${currency} ${details.group}`
}

const getCustodianContactLabel = (custodian: CustodianOption) => {
  const contact = custodian.contact?.trim()
  const dialCode = custodian.dialCode?.trim()
  if (!contact) return custodian.wallet || 'Contacto pendiente'
  if (!dialCode || contact.startsWith('+') || contact.replace(/\D/g, '').startsWith(dialCode.replace(/\D/g, ''))) {
    return contact
  }
  return `${dialCode} ${contact}`
}

type AppView = 'offers' | 'create-offer' | 'wallet' | 'donations' | 'custodian-auth' | 'guide'

const nautilusDownloadUrl = 'https://nautilus.io/'
const natriumDownloadUrl = 'https://natrium.io/'

const initialSellerForm = {
  amountXno: '',
  currency: 'COP' as Currency,
  price: '',
  paymentMethods: '',
}

const initialBuyerForm = {
  nanoAddress: '',
}

const initialBuyOfferForm = {
  amountXno: '',
  currency: 'COP' as Currency,
  price: '',
  nanoAddress: '',
  paymentMethods: '',
}

const initialCustodianForm = {
  wallet: '',
  role: 'CONCILIATOR' as 'ADMIN' | 'CONCILIATOR',
}

const takenOfferStorageKey = 'nanopaquete:taken-offer'
const custodianSessionStorageKey = 'nanopaquete:custodian-session'
const clientSessionStorageKey = 'nanopaquete:client-session'

const createClientSessionId = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

const getClientSessionId = () => {
  const stored = window.localStorage.getItem(clientSessionStorageKey)
  if (stored) return stored

  const created = createClientSessionId()
  window.localStorage.setItem(clientSessionStorageKey, created)
  return created
}

const getStoredTakenOffer = () => {
  try {
    const value = window.localStorage.getItem(takenOfferStorageKey)
    return value ? (JSON.parse(value) as TakenOffer) : null
  } catch {
    return null
  }
}

const getStoredCustodianSession = () => {
  try {
    const value = window.localStorage.getItem(custodianSessionStorageKey)
    const session = value ? (JSON.parse(value) as CustodianSession) : null
    return session && new Date(session.expiresAt).getTime() > Date.now() ? session : null
  } catch {
    return null
  }
}

const shortDate = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

const openNanoPayment = (paymentUri: string) => {
  window.location.href = paymentUri
}

const getAmountValue = (value: string) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

const getCustodianStatusRank = (status: PublicOffer['status']) =>
  ({ RELEASING: 0, NEGOTIATION: 1, ACTIVE: 2 } as Partial<Record<PublicOffer['status'], number>>)[status] ?? 9

const getNormalOfferRank = (offer: PublicOffer) => {
  if (offer.isOwnOffer && offer.status === 'NEGOTIATION') return 0
  if (offer.isOwnOffer) return 1
  return 2
}

const sortOffers = (offers: PublicOffer[], isCustodian: boolean) =>
  [...offers].sort((left, right) => {
    const rankDifference = isCustodian
      ? getCustodianStatusRank(left.status) - getCustodianStatusRank(right.status)
      : getNormalOfferRank(left) - getNormalOfferRank(right)

    if (rankDifference !== 0) return rankDifference

    const amountDifference = getAmountValue(left.amountXno) - getAmountValue(right.amountXno)
    if (amountDifference !== 0) return amountDifference

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })

type OfferGroup = {
  title: string
  offers: PublicOffer[]
}

const groupOffers = (offers: PublicOffer[]): OfferGroup[] => {
  const groups = new Map<string, PublicOffer[]>()

  offers.forEach((offer) => {
    const title = getOfferGroupTitle(offer.currency)
    groups.set(title, [...(groups.get(title) ?? []), offer])
  })

  return Array.from(groups.entries())
    .map(([title, groupedOffers]) => ({ title, offers: groupedOffers }))
    .sort((left, right) => right.offers.length - left.offers.length || left.title.localeCompare(right.title, 'es'))
}

const getPerspectiveOfferClass = (offer: PublicOffer) => {
  const isBuyingNano = offer.isPublishedOffer ? offer.offerType === 'BUY' : offer.offerType === 'SELL'
  return isBuyingNano ? 'buy-offer-card' : 'sell-offer-card'
}

const getInitialView = (): AppView => {
  const params = new URLSearchParams(window.location.search)
  return params.get('admin') === '1' || window.location.hash === '#admin' ? 'custodian-auth' : 'offers'
}

export function Nanopaquete() {
  const [sellerForm, setSellerForm] = useState(initialSellerForm)
  const [buyOfferForm, setBuyOfferForm] = useState(initialBuyOfferForm)
  const [createOfferType, setCreateOfferType] = useState<'SELL' | 'BUY'>('SELL')
  const [offers, setOffers] = useState<PublicOffer[]>([])
  const [custodians, setCustodians] = useState<CustodianOption[]>([])
  const [managedCustodians, setManagedCustodians] = useState<ManagedCustodian[]>([])
  const [canManageCustodians, setCanManageCustodians] = useState(false)
  const [custodianForm, setCustodianForm] = useState(initialCustodianForm)
  const [selectedCustodianId, setSelectedCustodianId] = useState('')
  const [selectedOffer, setSelectedOffer] = useState<PublicOffer | null>(null)
  const [buyerForm, setBuyerForm] = useState(initialBuyerForm)
  const [takenOffer, setTakenOffer] = useState<TakenOffer | null>(getStoredTakenOffer)
  const [custodianAuthIntent, setCustodianAuthIntent] = useState<CustodianAuthIntent | null>(null)
  const [custodianSession, setCustodianSession] = useState<CustodianSession | null>(getStoredCustodianSession)
  const [releaseFeeIntent, setReleaseFeeIntent] = useState<ReleaseFeeIntent | null>(null)
  const [editingPriceOfferId, setEditingPriceOfferId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<AppView>(getInitialView)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [clientSessionId] = useState(getClientSessionId)
  const autoStartedDepositOffers = useRef(new Set<string>())
  const visibleOffers = takenOffer ? [takenOffer.offer] : sortOffers(offers, Boolean(custodianSession))
  const offerGroups = groupOffers(visibleOffers)
  const pendingDepositOfferId = visibleOffers.find((offer) => offer.canDepositNano)?.id
  const donationCustodian = custodians.find((custodian) => custodian.isLeader && custodian.wallet) ?? custodians.find((custodian) => custodian.wallet)
  const donationWallet = donationCustodian?.wallet ?? ''
  const donationPaymentUri = donationWallet ? `nano:${donationWallet}` : ''
  const disputeConciliators = custodians.filter((custodian) => custodian.contact || custodian.wallet)
  const takenOfferId = takenOffer?.offer.id
  const displayedChatMessages = chatMessages.filter((message) => message.offerId === takenOfferId)
  const displayedManagedCustodians = [...managedCustodians].sort((left, right) => {
    if (left.id === custodianSession?.custodianId) return -1
    if (right.id === custodianSession?.custodianId) return 1
    return left.wallet.localeCompare(right.wallet, 'es')
  })

  const loadOffers = async () => {
    setError(null)
    setLoading('offers')

    try {
      const response = await getOffers(clientSessionId, custodianSession?.sessionId)
      setOffers(response.offers)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las ofertas.')
    } finally {
      setLoading(null)
    }
  }

  const loadCustodians = async () => {
    const response = await getCustodians()
    setCustodians(response.custodians)
    setSelectedCustodianId((current) =>
      response.custodians.some((custodian) => custodian.id === current) ? current : response.custodians[0]?.id || '',
    )
  }

  useEffect(() => {
    let ignore = false

    getCustodians()
      .then((response) => {
        if (ignore) return
        setCustodians(response.custodians)
        setSelectedCustodianId((current) => current || response.custodians[0]?.id || '')
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las direcciones autorizadas.')
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    Promise.all([getOffers(clientSessionId, custodianSession?.sessionId), getBuyerNegotiation(clientSessionId)])
      .then(([offersResponse, negotiationResponse]) => {
        if (ignore) return
        setOffers(offersResponse.offers)
        setTakenOffer(negotiationResponse.negotiation)
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las ofertas.')
        }
      })

    return () => {
      ignore = true
    }
  }, [clientSessionId, custodianSession?.sessionId])

  useEffect(() => {
    if (!takenOfferId) return undefined

    const interval = window.setInterval(() => {
      getBuyerNegotiation(clientSessionId)
        .then((response) => setTakenOffer(response.negotiation))
        .catch(() => undefined)
    }, 10000)

    return () => window.clearInterval(interval)
  }, [clientSessionId, takenOfferId])

  useEffect(() => {
    if (!takenOfferId || !takenOffer?.offer.canUseChat) {
      return undefined
    }

    let ignore = false
    const loadChat = () => {
      getOfferChat(takenOfferId, clientSessionId)
        .then((response) => {
          if (!ignore) setChatMessages(response.messages)
        })
        .catch(() => undefined)
    }

    loadChat()
    const interval = window.setInterval(loadChat, 5000)

    return () => {
      ignore = true
      window.clearInterval(interval)
    }
  }, [clientSessionId, takenOffer?.offer.canUseChat, takenOfferId])

  useEffect(() => {
    if (takenOfferId || activeView !== 'offers') return undefined

    const interval = window.setInterval(() => {
      getOffers(clientSessionId, custodianSession?.sessionId)
        .then((response) => setOffers(response.offers))
        .catch(() => undefined)
    }, 10000)

    return () => window.clearInterval(interval)
  }, [activeView, clientSessionId, custodianSession?.sessionId, takenOfferId])

  useEffect(() => {
    if (!pendingDepositOfferId) return undefined
    if (releaseFeeIntent?.offerId === pendingDepositOfferId) return undefined
    if (autoStartedDepositOffers.current.has(pendingDepositOfferId)) return undefined

    let ignore = false
    const loadingKey = `release-start:${pendingDepositOfferId}`
    autoStartedDepositOffers.current.add(pendingDepositOfferId)
    setError(null)
    setLoading(loadingKey)

    startReleaseFee(pendingDepositOfferId, clientSessionId)
      .then((intent) => {
        if (!ignore) setReleaseFeeIntent(intent)
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError instanceof Error ? requestError.message : 'No se pudo preparar el deposito.')
      })
      .finally(() => {
        if (!ignore) setLoading((current) => (current === loadingKey ? null : current))
      })

    return () => {
      ignore = true
    }
  }, [clientSessionId, pendingDepositOfferId, releaseFeeIntent?.offerId])

  useEffect(() => {
    if (takenOffer) {
      window.localStorage.setItem(takenOfferStorageKey, JSON.stringify(takenOffer))
      return
    }

    window.localStorage.removeItem(takenOfferStorageKey)
  }, [takenOffer])

  useEffect(() => {
    if (custodianSession) {
      window.localStorage.setItem(custodianSessionStorageKey, JSON.stringify(custodianSession))
      return
    }

    window.localStorage.removeItem(custodianSessionStorageKey)
  }, [custodianSession])

  useEffect(() => {
    if (!custodianSession) return

    let ignore = false

    getManagedCustodians(custodianSession.sessionId)
      .then((response) => {
        if (ignore) return
        setManagedCustodians(response.custodians)
        setCanManageCustodians(response.canManage)
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la lista de direcciones autorizadas.')
        }
      })

    return () => {
      ignore = true
    }
  }, [custodianSession])

  const updateSellerForm = (field: keyof typeof sellerForm, value: string) => {
    setSellerForm((current) => ({ ...current, [field]: value }))
  }

  const updateBuyerForm = (field: keyof typeof buyerForm, value: string) => {
    setBuyerForm((current) => ({ ...current, [field]: value }))
  }

  const updateBuyOfferForm = (field: keyof typeof buyOfferForm, value: string) => {
    setBuyOfferForm((current) => ({ ...current, [field]: value }))
  }

  const updateCustodianForm = (field: keyof typeof custodianForm, value: string) => {
    setCustodianForm((current) => ({ ...current, [field]: value }))
  }

  const handleAddCustodian = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!custodianSession || !canManageCustodians) return
    setError(null)
    setLoading('custodian-add')

    try {
      const response = await addManagedCustodian({
        custodianSessionId: custodianSession.sessionId,
        wallet: custodianForm.wallet,
        role: custodianForm.role,
      })
      setManagedCustodians(response.custodians)
      setCustodianForm(initialCustodianForm)
      await loadCustodians()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo agregar la direccion autorizada.')
    } finally {
      setLoading(null)
    }
  }

  const handleDeleteCustodian = async (custodianId: string) => {
    if (!custodianSession || !canManageCustodians) return
    setError(null)
    setLoading(`custodian-delete:${custodianId}`)

    try {
      const response = await deleteManagedCustodian(custodianId, custodianSession.sessionId)
      setManagedCustodians(response.custodians)
      await loadCustodians()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo eliminar la direccion autorizada.')
    } finally {
      setLoading(null)
    }
  }

  const handlePublishSellOffer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading('publish-sell')

    try {
      await publishOffer({
        amountXno: sellerForm.amountXno,
        currency: sellerForm.currency,
        price: sellerForm.price,
        paymentMethods: sellerForm.paymentMethods,
        custodianId: selectedCustodianId,
        clientSessionId,
      })
      setSellerForm(initialSellerForm)
      setActiveView('offers')
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo publicar la oferta de venta.')
    } finally {
      setLoading(null)
    }
  }

  const handlePublishBuyOffer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setLoading('publish-buy')

    try {
      await publishBuyOffer({
        amountXno: buyOfferForm.amountXno,
        currency: buyOfferForm.currency,
        price: buyOfferForm.price,
        buyerNanoAddress: buyOfferForm.nanoAddress,
        paymentMethods: buyOfferForm.paymentMethods,
        clientSessionId,
      })
      setBuyOfferForm(initialBuyOfferForm)
      setActiveView('offers')
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo publicar la oferta de compra.')
    } finally {
      setLoading(null)
    }
  }

  const handleTakeOffer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedOffer) return
    if (takenOffer) {
      setError('Ya tienes una negociacion abierta. Cancela o cierra esa negociacion antes de tomar otra oferta.')
      return
    }
    setError(null)
    setLoading('take')

    try {
      const response = await takeOffer(selectedOffer.id, {
        buyerNanoAddress: selectedOffer.offerType === 'SELL' ? buyerForm.nanoAddress : undefined,
        clientSessionId,
      })
      setTakenOffer(response)
      setSelectedOffer(null)
      setBuyerForm(initialBuyerForm)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo tomar la oferta.')
    } finally {
      setLoading(null)
    }
  }

  const handleSendChatMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!takenOffer?.offer.canUseChat || !chatDraft.trim()) return
    setError(null)
    setLoading('chat-send')

    try {
      const response = await sendOfferChatMessage(takenOffer.offer.id, {
        clientSessionId,
        body: chatDraft,
      })
      setChatMessages(response.messages)
      setChatDraft('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo enviar el mensaje.')
    } finally {
      setLoading(null)
    }
  }

  const handleStartEditPrice = (offer: PublicOffer) => {
    setEditingPriceOfferId(offer.id)
    setEditingPrice(offer.price)
  }

  const handleDeleteOffer = async (offerId: string) => {
    setError(null)
    setLoading(`offer-delete:${offerId}`)

    try {
      await deleteOffer(offerId, clientSessionId)
      setOffers((currentOffers) => currentOffers.filter((offer) => offer.id !== offerId))
      if (selectedOffer?.id === offerId) setSelectedOffer(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo eliminar la oferta.')
    } finally {
      setLoading(null)
    }
  }

  const handleUpdateOfferPrice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingPriceOfferId) return
    setError(null)
    setLoading(`price-update:${editingPriceOfferId}`)

    try {
      const response = await updateOfferPrice(editingPriceOfferId, { price: editingPrice, clientSessionId })
      setOffers((currentOffers) => currentOffers.map((offer) => (offer.id === response.offer.id ? response.offer : offer)))
      if (takenOffer?.offer.id === response.offer.id) {
        setTakenOffer({ ...takenOffer, offer: response.offer })
      }
      setEditingPriceOfferId(null)
      setEditingPrice('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar el precio.')
    } finally {
      setLoading(null)
    }
  }

  const handleStartReleaseFee = async (offerId: string) => {
    setError(null)
    setLoading(`release-start:${offerId}`)

    try {
      const intent = await startReleaseFee(offerId, clientSessionId)
      setReleaseFeeIntent(intent)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar el deposito.')
    } finally {
      setLoading(null)
    }
  }

  const handleVerifyReleaseFee = async () => {
    if (!releaseFeeIntent) return
    setError(null)
    setLoading('release-verify')

    try {
      await verifyReleaseFee(releaseFeeIntent.id, clientSessionId)
      setReleaseFeeIntent(null)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar el deposito.')
    } finally {
      setLoading(null)
    }
  }

  const handleConfirmSellerPayment = async (offerId: string) => {
    setError(null)
    setLoading(`confirm-payment:${offerId}`)

    try {
      await confirmSellerPayment(offerId, clientSessionId)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo confirmar el pago recibido.')
    } finally {
      setLoading(null)
    }
  }

  const handleVerifyCustodianRelease = async (offerId: string) => {
    setError(null)
    setLoading(`custodian-release:${offerId}`)

    try {
      if (!custodianSession) {
        setError('Autenticacion autorizada requerida.')
        return
      }
      await verifyCustodianRelease(offerId, custodianSession.sessionId)
      if (takenOffer?.offer.id === offerId) setTakenOffer(null)
      setOffers((currentOffers) => currentOffers.filter((offer) => offer.id !== offerId))
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la transferencia autorizada.')
    } finally {
      setLoading(null)
    }
  }

  const handleReleaseExpiredTakenOffer = async (offerId: string) => {
    setError(null)
    setLoading(`release-expired:${offerId}`)

    try {
      if (!custodianSession) {
        setError('Autenticacion autorizada requerida.')
        return
      }
      await releaseExpiredTakenOffer(offerId, custodianSession.sessionId)
      if (takenOffer?.offer.id === offerId) setTakenOffer(null)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo liberar la oferta.')
    } finally {
      setLoading(null)
    }
  }

  const handleStartCustodianAuth = async () => {
    setError(null)
    setLoading('custodian-auth-start')

    try {
      const intent = await startCustodianAuth()
      setCustodianAuthIntent(intent)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar la autenticacion autorizada.')
    } finally {
      setLoading(null)
    }
  }

  const handleVerifyCustodianAuth = async () => {
    if (!custodianAuthIntent) return
    setError(null)
    setLoading('custodian-auth-verify')

    try {
      const session = await verifyCustodianAuth(custodianAuthIntent.id)
      setCustodianSession(session)
      setCustodianAuthIntent(null)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la autenticacion autorizada.')
    } finally {
      setLoading(null)
    }
  }

  const handleCloseCustodianSession = async () => {
    const sessionId = custodianSession?.sessionId
    setCustodianSession(null)
    setCustodianAuthIntent(null)
    setManagedCustodians([])
    setCanManageCustodians(false)
    setCustodianForm(initialCustodianForm)
    window.localStorage.removeItem(custodianSessionStorageKey)
    setError(null)

    try {
      if (sessionId) await logoutCustodianAuth(sessionId)
      const response = await getOffers(clientSessionId)
      setOffers(response.offers)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las ofertas.')
    }
  }

  const handleCancelTakenOffer = async (offerId = takenOffer?.offer.id) => {
    if (!offerId) return
    setError(null)
    setLoading(`cancel-take:${offerId}`)

    try {
      await cancelTakenOffer(offerId, clientSessionId)
      if (takenOffer?.offer.id === offerId) setTakenOffer(null)
      if (releaseFeeIntent?.offerId === offerId) setReleaseFeeIntent(null)
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cancelar el proceso.')
    } finally {
      setLoading(null)
    }
  }

  const copyValue = async (value: string) => {
    await navigator.clipboard.writeText(value)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-icon" aria-hidden="true">
            <img src="/icnano.png" alt="" />
          </span>
          <div>
            <h1>Nanopaquete</h1>
            <p className="topbar-subtitle">Custodia de Nano para comercio P2P</p>
          </div>
        </div>
        <div className="topbar-actions menu-area">
          <button className="icon-button menu-trigger" type="button" onClick={() => setIsMenuOpen((current) => !current)} aria-label="Abrir menu" title="Menu">
            <Menu size={20} />
            <span>Menu</span>
          </button>
          {isMenuOpen && (
            <div className="app-menu">
              <button type="button" onClick={() => { setActiveView('create-offer'); setIsMenuOpen(false) }}>Crear oferta</button>
              <button type="button" onClick={() => { setActiveView('wallet'); setIsMenuOpen(false) }}>Descargar wallet</button>
              <button type="button" onClick={() => { setActiveView('guide'); setIsMenuOpen(false) }}>Guia</button>
            </div>
          )}
        </div>
      </header>

      {activeView !== 'offers' && (
        <section className="page-toolbar">
          <button className="ghost-button" type="button" onClick={() => setActiveView('offers')}>
            <ArrowLeft size={17} />
            Volver a ofertas
          </button>
        </section>
      )}

      {activeView === 'custodian-auth' && !custodianAuthIntent && (
        <section className="single-page-panel">
          <div className="panel">
            <h2>Acceso privado</h2>
            <p>Ingreso solo con direccion Nano autorizada.</p>
            {custodianSession ? (
              <>
                <div className="private-box custodian-admin-box">
                  <div className="panel-heading">
                    <h3>{custodianSession.role === 'ADMIN' ? 'Administrador' : 'Conciliador'}</h3>
                    <p>{custodianSession.role === 'ADMIN' ? 'Acceso a ofertas y cuentas Nano.' : 'Acceso limitado a ofertas y conciliacion de disputas.'}</p>
                  </div>
                  <div className="button-row">
                    <a className="wallet-download-link standalone-link" href="/admin/offers">
                      Ofertas
                    </a>
                    {custodianSession.role === 'ADMIN' && (
                      <a className="wallet-download-link standalone-link" href="/admin/nano-accounts">
                        Cuentas Nano
                      </a>
                    )}
                  </div>
                </div>
                {!!managedCustodians.length && (
                  <div className="private-box custodian-admin-box">
                    <div className="panel-heading">
                      <h3>Direcciones autorizadas</h3>
                    </div>
                    <div className="custodian-list">
                      {displayedManagedCustodians.map((custodian) => (
                        <article className="custodian-list-item" key={custodian.id}>
                          <div>
                            <strong>Direccion Nano</strong>
                            <small>{custodian.wallet}</small>
                          </div>
                          <span className="offer-status-pill">{custodian.role === 'ADMIN' ? 'Administrador' : 'Conciliador'}</span>
                          {canManageCustodians && (
                            <div className="custodian-row-actions">
                              <button
                                className="ghost-button danger-button"
                                type="button"
                                onClick={() => void handleDeleteCustodian(custodian.id)}
                                disabled={loading === `custodian-delete:${custodian.id}`}
                              >
                                <X size={16} />
                                Eliminar
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                )}
                {canManageCustodians && (
                  <div className="private-box custodian-admin-box">
                    <div className="panel-heading">
                      <h3>Autorizar direccion Nano</h3>
                    </div>
                    <form className="stack-form custodian-admin-form" onSubmit={handleAddCustodian}>
                      <label>
                        Direccion Nano
                        <input value={custodianForm.wallet} onChange={(event) => updateCustodianForm('wallet', event.target.value)} required />
                      </label>
                      <label>
                        Perfil
                        <select value={custodianForm.role} onChange={(event) => updateCustodianForm('role', event.target.value)}>
                          <option value="CONCILIATOR">Conciliador: solo ofertas</option>
                          <option value="ADMIN">Administrador: ofertas y cuentas</option>
                        </select>
                      </label>
                      <button className="primary-button" type="submit" disabled={loading === 'custodian-add'}>
                        Autorizar direccion
                      </button>
                    </form>
                  </div>
                )}
                <button className="ghost-button danger-button standalone-link" type="button" onClick={() => void handleCloseCustodianSession()}>
                  <X size={16} />
                  Cerrar sesion
                </button>
              </>
            ) : (
              <button className="primary-button" type="button" onClick={handleStartCustodianAuth} disabled={loading === 'custodian-auth-start'}>
                <ShieldCheck size={18} />
                Iniciar sesion
              </button>
            )}
          </div>
        </section>
      )}

      {activeView === 'custodian-auth' && custodianAuthIntent && (
        <section className="intro-band compact-intro-band auth-panel-band">
          <div className="private-box custodian-auth-box">
            <p className="eyebrow">Acceso privado</p>
            <p>Transfiere {custodianAuthIntent.amountXno} XNO desde la cuenta Nano autorizada a la cuenta asignada por Nanopaquete.</p>
            <div className="payment-actions">
              <button className="primary-button" type="button" onClick={() => openNanoPayment(custodianAuthIntent.paymentUri)}>
                <Wallet size={18} />
                Autenticar wallet
              </button>
              <button className="ghost-button" type="button" onClick={() => void copyValue(custodianAuthIntent.receiverAddress)}>
                <Copy size={16} />
                Copiar wallet
              </button>
            </div>
            <div className="payment-qr" aria-label="QR de autenticacion autorizada">
              <QRCodeSVG value={custodianAuthIntent.paymentUri} size={176} marginSize={2} />
            </div>
            <div className="button-row">
              <button className="primary-button" type="button" onClick={handleVerifyCustodianAuth} disabled={loading === 'custodian-auth-verify'}>
                Verificar acceso
              </button>
              <button className="ghost-button danger-button" type="button" onClick={() => setCustodianAuthIntent(null)}>
                <X size={16} />
                Cerrar
              </button>
            </div>
          </div>
        </section>
      )}

      {error && <div className="status-message error">{error}</div>}

      {activeView === 'wallet' && (
        <section className="single-page-panel">
          <div className="panel">
            <h2>Descargar wallet</h2>
            <p>Natrium y Nautilus son monederos para Nano. Te permiten recibir, guardar y enviar tus XNO desde el celular, y los necesitas para copiar tu direccion o abrir los pagos que genera Nanopaquete.</p>
            <p>Instala uno antes de comprar o vender para tener lista la wallet donde recibiras o desde donde enviaras Nano.</p>
            <div className="wallet-options">
              <a className="wallet-download-link standalone-link" href={natriumDownloadUrl} target="_blank" rel="noreferrer">
                <Download size={17} />
                Abrir Natrium
              </a>
              <a className="wallet-download-link standalone-link" href={nautilusDownloadUrl} target="_blank" rel="noreferrer">
                <Download size={17} />
                Abrir Nautilus
              </a>
            </div>
          </div>
        </section>
      )}

      {activeView === 'donations' && (
        <section className="single-page-panel">
          <div className="panel donation-panel">
            <h2>Donaciones</h2>
            <p>Las donaciones ayudan a sostener el desarrollo, el mantenimiento y la infraestructura necesaria para que Nanopaquete funcione de forma continua.</p>
            <p>Cualquier aporte en Nano se recibe en la cuenta de conciliación actual.</p>
            {donationPaymentUri ? (
              <>
                <div className="payment-actions">
                  <button className="primary-button" type="button" onClick={() => openNanoPayment(donationPaymentUri)}>
                    <Wallet size={18} />
                    Donar con Nano
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void copyValue(donationWallet)}>
                    <Copy size={16} />
                    Copiar cuenta
                  </button>
                </div>
                <div className="payment-qr" aria-label="QR para donar Nano">
                  <QRCodeSVG value={donationPaymentUri} size={176} marginSize={2} />
                </div>
                <dl>
                  <dt>Cuenta Nano</dt>
                  <dd>{donationWallet}</dd>
                  <dt>Conciliador</dt>
                  <dd>{donationCustodian?.name ?? 'No disponible'}</dd>
                </dl>
              </>
            ) : (
              <p className="empty-state">No hay una cuenta de donacion disponible en este momento.</p>
            )}
          </div>
        </section>
      )}

      {activeView === 'guide' && (
        <section className="single-page-panel">
          <div className="panel guide-panel">
            <h2>Guía</h2>
            <h3>Condiciones generales</h3>
            <p>Nanopaquete organiza negociaciones P2P de XNO con custodia automática. Todas las ofertas aparecen en una misma página y se diferencian por tipo: compra de Nano y venta de Nano.</p>
            <p>La plataforma no persigue el precio del mercado. Cada usuario define cuántos XNO compra o vende, qué activo entrega o recibe a cambio y cuál es la cantidad de ese activo. Esa libertad crea un mercado interno donde la competencia entre ofertas regula la inflación o depreciación dentro de Nanopaquete.</p>
            <p>Cuando una oferta entra en negociación, Nanopaquete crea una cuenta Nano temporal para custodiar los fondos de esa operación. Esa cuenta se guarda de forma segura en el servidor y no se muestra a los usuarios.</p>
            <h3>Publicar venta de Nano</h3>
            <p>El vendedor publica una oferta indicando la cantidad de XNO, el activo que recibe a cambio, la cantidad de ese activo y los métodos de pago aceptados.</p>
            <p>La oferta queda visible y vinculada al equipo desde el que fue creada. Mientras nadie la tome, el vendedor puede eliminarla. Las ofertas disponibles vencen automáticamente a las 24 horas.</p>
            <p>Cuando un comprador toma la oferta, ingresa la cuenta Nano donde espera recibir los fondos. Nanopaquete le informa que el vendedor debe depositar los XNO.</p>
            <p>El vendedor recibe la notificación, ve el botón y el QR de depósito, y deposita la cantidad publicada más el 0,2% de comisión de plataforma.</p>
            <p>Cuando el depósito queda confirmado, se habilita un chat interno para que comprador y vendedor coordinen el pago dentro de la plataforma. El vendedor conserva el botón para confirmar el pago recibido.</p>
            <p>Cuando el vendedor confirma que recibió el pago, Nanopaquete transfiere los XNO a la cuenta registrada por el comprador y cierra la negociación.</p>
            <h3>Publicar compra de Nano</h3>
            <p>El comprador publica una oferta indicando la cantidad de XNO que quiere comprar, el activo que entrega a cambio, la cantidad de ese activo, su cuenta Nano receptora y los métodos de pago disponibles.</p>
            <p>Cuando un vendedor toma la oferta, Nanopaquete crea la cuenta Nano temporal de custodia y habilita al vendedor el botón y el QR para depositar.</p>
            <p>El vendedor deposita la cantidad de XNO de la oferta más el 0,2% de comisión de plataforma. Cuando el depósito queda confirmado, Nanopaquete habilita el chat interno para que ambas partes acuerden el pago.</p>
            <p>Cuando el comprador paga, el vendedor confirma la recepción del pago y Nanopaquete libera los XNO a la cuenta Nano registrada por el comprador.</p>
            <h3>Cola de negociaciones</h3>
            <p>Si una persona tiene varios anuncios y ya está cerrando una negociación, las siguientes tomas quedan en cola. La plataforma muestra el motivo a quienes esperan y activa la siguiente negociación cuando la contraparte libera la anterior.</p>
            <h3>Posibles disputas</h3>
            <p>Si aparece una disputa durante una negociación, conserva los comprobantes y contacta a un conciliador de Nanopaquete. Los conciliadores son personas de confianza de la plataforma que autorizan mostrar sus datos en esta guía para ayudar a resolver disputas.</p>
            <div className="conciliator-list">
              {disputeConciliators.map((conciliator) => (
                <article className="conciliator-item" key={conciliator.id}>
                  <strong>{conciliator.name}</strong>
                  <span>{getCustodianContactLabel(conciliator)}</span>
                </article>
              ))}
              {!disputeConciliators.length && <p className="empty-state">No hay conciliadores publicados en este momento.</p>}
            </div>
            <div className="guide-disputes">
              <p><strong>Una parte no responde:</strong> la otra parte debe conservar comprobantes y solicitar revisión a un conciliador.</p>
              <p><strong>El pago externo no se confirma:</strong> los XNO permanecen en custodia hasta que exista una confirmación suficiente o una decisión de conciliación.</p>
              <p><strong>El chat no fue suficiente para coordinar:</strong> la revisión se hace con la información disponible en la negociación y los comprobantes que pueda aportar cada parte.</p>
              <p><strong>El comprador ingresó una cuenta Nano incorrecta:</strong> la cuenta Nano debe revisarse antes de confirmar la operación, porque la liberación se realiza hacia la cuenta registrada en la negociación.</p>
              <p><strong>Hay una falla técnica:</strong> un conciliador revisa los datos de la negociación, los depósitos, el chat y el estado de la cuenta temporal.</p>
            </div>
          </div>
        </section>
      )}

      {(activeView === 'offers' || activeView === 'create-offer') && (
      <section className={activeView === 'offers' ? 'work-grid offers-only' : 'work-grid'}>
        {activeView === 'create-offer' && (
        <div className="panel seller-panel">
          <div className="panel-heading">
            <h2>Crear oferta</h2>
          </div>

          <div className="offer-type-tabs" role="tablist" aria-label="Tipo de oferta">
            <button
              className={createOfferType === 'SELL' ? 'selected' : ''}
              type="button"
              onClick={() => setCreateOfferType('SELL')}
            >
              Venta Nano
            </button>
            <button
              className={createOfferType === 'BUY' ? 'selected' : ''}
              type="button"
              onClick={() => setCreateOfferType('BUY')}
            >
              Compra Nano
            </button>
          </div>

          {createOfferType === 'SELL' && (
            <form className="stack-form publish-form deposit-start" onSubmit={handlePublishSellOffer}>
              <label>
                Cantidad de Nano a vender
                <input
                  inputMode="decimal"
                  placeholder="Ej. 10"
                  value={sellerForm.amountXno}
                  onChange={(event) => updateSellerForm('amountXno', event.target.value)}
                  required
                />
              </label>
              <label>
                Activo a recibir
                <select
                  value={sellerForm.currency}
                  onChange={(event) => updateSellerForm('currency', event.target.value as Currency)}
                >
                  {currencies.map((currency) => (
                    <option key={currency} value={currency}>{getCurrencyLabel(currency)}</option>
                  ))}
                </select>
              </label>
              <label>
                Cantidad del activo
                <input
                  placeholder="Ej. 180000"
                  value={sellerForm.price}
                  onChange={(event) => updateSellerForm('price', event.target.value)}
                  required
                />
              </label>
              <label>
                Metodo(s) de pago
                <input
                  placeholder="Ej. Nequi, transferencia bancaria, efectivo"
                  value={sellerForm.paymentMethods}
                  onChange={(event) => updateSellerForm('paymentMethods', event.target.value)}
                  required
                />
              </label>
              <button className="primary-button create-offer-button" type="submit" disabled={loading === 'publish-sell'}>
                <Wallet size={18} />
                Publicar venta
              </button>
            </form>
          )}

          {createOfferType === 'BUY' && (
            <form className="stack-form publish-form deposit-start" onSubmit={handlePublishBuyOffer}>
              <label>
                Cantidad de Nano a comprar
                <input
                  inputMode="decimal"
                  placeholder="Ej. 10"
                  value={buyOfferForm.amountXno}
                  onChange={(event) => updateBuyOfferForm('amountXno', event.target.value)}
                  required
                />
              </label>
              <label>
                Activo que entregas
                <select
                  value={buyOfferForm.currency}
                  onChange={(event) => updateBuyOfferForm('currency', event.target.value as Currency)}
                >
                  {currencies.map((currency) => (
                    <option key={currency} value={currency}>{getCurrencyLabel(currency)}</option>
                  ))}
                </select>
              </label>
              <label>
                Cantidad del activo
                <input
                  placeholder="Ej. 180000"
                  value={buyOfferForm.price}
                  onChange={(event) => updateBuyOfferForm('price', event.target.value)}
                  required
                />
              </label>
              <label>
                Cuenta Nano donde recibirás los XNO
                <input
                  placeholder="nano_..."
                  value={buyOfferForm.nanoAddress}
                  onChange={(event) => updateBuyOfferForm('nanoAddress', event.target.value)}
                  required
                />
              </label>
              <label>
                Metodo(s) de pago
                <input
                  placeholder="Ej. Nequi, transferencia bancaria, efectivo"
                  value={buyOfferForm.paymentMethods}
                  onChange={(event) => updateBuyOfferForm('paymentMethods', event.target.value)}
                  required
                />
              </label>
              <button className="primary-button create-offer-button" type="submit" disabled={loading === 'publish-buy'}>
                <Wallet size={18} />
                Publicar compra
              </button>
            </form>
          )}

        </div>
        )}

        {activeView === 'offers' && (
        <div className="panel offers-panel">
          <div className="panel-heading inline-heading">
            <div>
              <h2>Ofertas disponibles</h2>
            </div>
            <span>{visibleOffers.length} visibles</span>
          </div>

          <div className="offer-list">
            {offerGroups.map((group) => (
              <section className="offer-group" key={group.title}>
                <div className="offer-group-heading">
                  <h3>{group.title}</h3>
                  <span>{group.offers.length} {group.offers.length === 1 ? 'oferta' : 'ofertas'}</span>
                </div>
                {group.offers.map((offer) => {
                  const isSelected = selectedOffer?.id === offer.id

                  return (
                    <article
                      className={`${isSelected ? 'offer-card selected-offer-card' : 'offer-card'} ${getPerspectiveOfferClass(offer)}`}
                      key={offer.id}
                    >
                  <div>
                    {offer.isPublishedOffer && (
                      <small>{offer.offerType === 'BUY' ? 'Estás comprando Nano' : 'Estás vendiendo Nano'}</small>
                    )}
                    <p className="offer-amount">{offer.amountXno} XNO</p>
                    <p>{offer.price} {offer.currency}</p>
                    {offer.paymentMethods && <small>Pago: {offer.paymentMethods}</small>}
                    <small>Estado: {offer.status === 'ACTIVE' ? 'Activa' : offer.status === 'QUEUED' ? 'En cola' : offer.status === 'NEGOTIATION' ? 'En negociacion' : 'Liberando'}</small>
                    <small>Publicada {shortDate(offer.createdAt)}</small>
                  </div>
                  {offer.canEditPrice && editingPriceOfferId !== offer.id && (
                    <div className="offer-owner-actions">
                      <button type="button" onClick={() => handleStartEditPrice(offer)}>
                        Editar precio
                      </button>
                      {offer.canDeleteOffer && (
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => void handleDeleteOffer(offer.id)}
                          disabled={loading === `offer-delete:${offer.id}`}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                  {offer.canEditPrice && editingPriceOfferId === offer.id && (
                    <form className="inline-price-form" onSubmit={handleUpdateOfferPrice}>
                      <label>
                        Nuevo precio
                        <input
                          value={editingPrice}
                          onChange={(event) => setEditingPrice(event.target.value)}
                          required
                          autoFocus
                        />
                      </label>
                      <div className="button-row">
                        <button className="primary-button" type="submit" disabled={loading === `price-update:${offer.id}`}>
                          Guardar
                        </button>
                        <button className="ghost-button" type="button" onClick={() => { setEditingPriceOfferId(null); setEditingPrice('') }}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                  {offer.canDepositNano && releaseFeeIntent?.offerId !== offer.id && (
                    <button
                      type="button"
                      onClick={() => void handleStartReleaseFee(offer.id)}
                      disabled={loading === `release-start:${offer.id}`}
                    >
                      {loading === `release-start:${offer.id}` ? 'Generando QR...' : 'Depositar Nano'}
                    </button>
                  )}
                  {offer.canConfirmPayment && (
                    <button
                      type="button"
                      onClick={() => void handleConfirmSellerPayment(offer.id)}
                      disabled={loading === `confirm-payment:${offer.id}`}
                    >
                      {offer.status === 'RELEASING' ? 'Reintentar liberación' : 'Confirmar pago recibido'}
                    </button>
                  )}
                  {offer.canCancelTake && !takenOffer && (
                    <button
                      className="ghost-button danger-button"
                      type="button"
                      onClick={() => void handleCancelTakenOffer(offer.id)}
                      disabled={loading === `cancel-take:${offer.id}`}
                    >
                      Cancelar proceso
                    </button>
                  )}
                  {releaseFeeIntent?.offerId === offer.id && (
                    <div className="private-box release-fee-box inline-release-fee-box">
                      <p className="eyebrow">Deposito de Nano</p>
                      <h3>Deposita {releaseFeeIntent.amountXno} XNO en la cuenta temporal.</h3>
                      <p>Cuando la app detecte esa transferencia, se habilitara el chat interno para continuar la negociacion.</p>
                      <div className="payment-actions">
                        <button className="primary-button" type="button" onClick={() => openNanoPayment(releaseFeeIntent.paymentUri)}>
                          <Wallet size={18} />
                          Depositar Nano
                        </button>
                        <button className="ghost-button" type="button" onClick={() => void copyValue(releaseFeeIntent.receiverAddress)}>
                          <Copy size={16} />
                          Copiar custodia
                        </button>
                      </div>
                      <div className="payment-qr" aria-label="QR de deposito Nano">
                        <QRCodeSVG value={releaseFeeIntent.paymentUri} size={176} marginSize={2} />
                      </div>
                      <dl>
                        <dt>Hacia custodia</dt>
                        <dd>{releaseFeeIntent.receiverAddress}</dd>
                        <dt>Monto</dt>
                        <dd>{releaseFeeIntent.amountXno} XNO</dd>
                      </dl>
                      <button className="primary-button" type="button" onClick={handleVerifyReleaseFee} disabled={loading === 'release-verify'}>
                        Verificar deposito
                      </button>
                      <button className="ghost-button danger-button" type="button" onClick={() => setReleaseFeeIntent(null)}>
                        <X size={16} />
                        Cerrar
                      </button>
                    </div>
                  )}
                  {offer.status === 'NEGOTIATION' && offer.isPublishedOffer && !offer.sellerDepositConfirmed && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">Alguien tomó tu oferta</p>
                      <p>
                        {offer.canDepositNano
                          ? 'Deposita los XNO en la cuenta temporal para continuar la negociación.'
                          : 'Espera la confirmación del depósito Nano para habilitar el chat interno.'}
                      </p>
                    </div>
                  )}
                  {offer.status === 'QUEUED' && (offer.isPublishedOffer || offer.isOwnOffer) && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">En cola</p>
                      <p>{offer.queueReason || 'La contraparte tiene una negociacion anterior abierta. Espera un poco mientras libera esa operacion.'}</p>
                    </div>
                  )}
                  {custodianSession && offer.status === 'NEGOTIATION' && offer.canCustodianReleaseOffer && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">Revision de custodia</p>
                      <p>Esta negociacion supero el tiempo de espera sin deposito confirmado.</p>
                      <button
                        className="ghost-button danger-button"
                        type="button"
                        onClick={() => void handleReleaseExpiredTakenOffer(offer.id)}
                        disabled={loading === `release-expired:${offer.id}`}
                      >
                        <X size={16} />
                        {loading === `release-expired:${offer.id}` ? 'Liberando...' : 'Liberar oferta'}
                      </button>
                    </div>
                  )}
                  {offer.status === 'RELEASING' && !offer.canCustodianReleaseFunds && (
                    <span className="offer-status-pill">Liberando</span>
                  )}
                  {offer.canCustodianReleaseFunds && (
                    <div className="private-box custodian-release-box">
                      <span className="offer-status-pill">Liberando</span>
                      <h3>Transferencia autorizada</h3>
                      <p>Esta oferta ya fue confirmada por el vendedor. Nanopaquete enviara los fondos desde la cuenta temporal al comprador.</p>
                      <div className="payment-actions">
                            <button
                              className="primary-button"
                              type="button"
                              onClick={() => void handleVerifyCustodianRelease(offer.id)}
                              disabled={loading === `custodian-release:${offer.id}`}
                            >
                              <CheckCircle2 size={16} />
                              {loading === `custodian-release:${offer.id}` ? 'Verificando...' : 'Verificar liberacion'}
                            </button>
                      </div>
                    </div>
                  )}
                  {!isSelected && offer.status === 'ACTIVE' && !offer.isOwnOffer && (
                    <button
                      className={offer.offerType === 'SELL' ? 'take-buy-button' : 'take-sell-button'}
                      type="button"
                      onClick={() => {
                        if (takenOffer) {
                          setError('Ya tienes una negociacion abierta. Cancela o cierra esa negociacion antes de tomar otra oferta.')
                          return
                        }
                        setSelectedOffer(offer)
                      }}
                    >
                      {offer.offerType === 'SELL' ? 'Comprar Nano' : 'Vender Nano'}
                    </button>
                  )}
                  {isSelected && (
                    <form className="take-form inline-take-form" onSubmit={handleTakeOffer}>
                      <div>
                        <p className="eyebrow">{offer.offerType === 'SELL' ? 'Comprar Nano' : 'Vender Nano'}</p>
                        <h3>{offer.amountXno} XNO por {offer.price} {offer.currency}</h3>
                      </div>
                      {offer.offerType === 'SELL' && (
                        <label>
                          Cuenta Nano donde recibirás los XNO
                          <input
                            placeholder="nano_..."
                            value={buyerForm.nanoAddress}
                            onChange={(event) => updateBuyerForm('nanoAddress', event.target.value)}
                            required
                            autoFocus
                          />
                        </label>
                      )}
                      <p className="form-note">
                        Cuando el vendedor deposite los XNO, se habilitara el chat interno para coordinar el pago por los metodos publicados.
                      </p>
                      <div className="button-row">
                        <button className="primary-button" type="submit" disabled={loading === 'take'}>
                          Confirmar
                        </button>
                        <button className="ghost-button" type="button" onClick={() => setSelectedOffer(null)}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                    </article>
                  )
                })}
              </section>
            ))}
            {!visibleOffers.length && <p className="empty-state">No hay ofertas activas en este momento.</p>}
          </div>


          {takenOffer && (
            <div className="private-box buyer-result">
              <p className="eyebrow">{takenOffer.offer.status === 'QUEUED' ? 'En cola' : takenOffer.offer.status === 'RELEASING' ? 'Pago confirmado' : 'Negociación iniciada'}</p>
              {takenOffer.offer.status === 'QUEUED' ? (
                <>
                  <h3>Esta negociacion esta esperando turno.</h3>
                  <p>{takenOffer.offer.queueReason || 'La contraparte tiene una negociacion anterior abierta. Espera un poco mientras libera esa operacion.'}</p>
                </>
              ) : takenOffer.offer.status === 'RELEASING' ? (
                <>
                  <h3>{takenOffer.offer.canConfirmPayment ? 'Confirmaste que recibiste el pago.' : 'El vendedor ya confirmó que recibió el pago.'}</h3>
                  <p>Nanopaquete está trabajando para liberar los fondos al comprador. Si la red tarda, el sistema reintentará automáticamente; espera unos minutos antes de solicitar intervención.</p>
                </>
              ) : !takenOffer.offer.sellerDepositConfirmed && takenOffer.offer.offerType === 'SELL' ? (
                <>
                  <h3>La oferta fue tomada y el vendedor debe depositar los XNO.</h3>
                  <p>Espera la confirmación del depósito antes de enviar el pago externo. Si el proceso se queda detenido, consulta la guía.</p>
                </>
              ) : !takenOffer.offer.sellerDepositConfirmed ? (
                <>
                  <h3>Deposita los XNO para iniciar la negociación.</h3>
                  <p>Después de confirmar el depósito, se habilitará el chat interno para acordar el pago externo.</p>
                </>
              ) : (
                <>
                  <h3>Chat interno habilitado.</h3>
                  <p>{takenOffer.offer.canConfirmPayment ? 'Los XNO ya están bloqueados en custodia. Coordina el pago en el chat y confirma cuando recibas el pago externo.' : 'Los XNO de esta oferta ya están bloqueados en custodia. Coordina el pago en el chat; el vendedor solo puede liberar a la cuenta que registraste cuando reciba el pago.'}</p>
                  <p>Si ocurre un contratiempo que no puedas solucionar directamente con la otra parte, consulta la guía.</p>
                </>
              )}
              <dl>
                <dt>Oferta tomada</dt>
                <dd>{takenOffer.offer.amountXno} XNO por {takenOffer.offer.price} {takenOffer.offer.currency}</dd>
                <dt>Metodo(s) de pago</dt>
                <dd>{takenOffer.paymentMethods || takenOffer.offer.paymentMethods || 'No informado'}</dd>
              </dl>
              {takenOffer.offer.canUseChat && (
                <section className="chat-box" aria-label="Chat de negociacion">
                  <div className="chat-messages">
                    {displayedChatMessages.map((message) => (
                      <article className={`chat-message ${message.senderRole === 'seller' ? 'seller-message' : 'buyer-message'}`} key={message.id}>
                        <strong>{message.senderLabel}</strong>
                        <p>{message.body}</p>
                        <small>{shortDate(message.createdAt)}</small>
                      </article>
                    ))}
                    {!displayedChatMessages.length && <p className="empty-state">Aun no hay mensajes en esta negociacion.</p>}
                  </div>
                  <form className="chat-form" onSubmit={handleSendChatMessage}>
                    <input
                      value={chatDraft}
                      onChange={(event) => setChatDraft(event.target.value)}
                      placeholder="Escribe un mensaje"
                      maxLength={1200}
                    />
                    <button className="primary-button" type="submit" disabled={loading === 'chat-send' || !chatDraft.trim()} aria-label="Enviar mensaje" title="Enviar mensaje">
                      <Send size={17} />
                    </button>
                  </form>
                </section>
              )}
              {takenOffer.offer.canCancelTake && (
                <button
                  className="ghost-button danger-button"
                  type="button"
                  onClick={() => void handleCancelTakenOffer()}
                  disabled={loading === `cancel-take:${takenOffer.offer.id}`}
                >
                  Cancelar proceso
                </button>
              )}
            </div>
          )}
        </div>
        )}
      </section>
      )}
    </main>
  )
}
