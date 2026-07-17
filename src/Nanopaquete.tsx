import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, Download, Menu, ShieldCheck, Wallet, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  addManagedCustodian,
  cancelTakenOffer,
  confirmSellerPayment,
  deleteOffer,
  deleteManagedCustodian,
  getManagedCustodians,
  getBuyerNegotiation,
  getCustodians,
  getOffers,
  logoutCustodianAuth,
  publishBuyOffer,
  publishOffer,
  releaseExpiredTakenOffer,
  startCustodianAuth,
  startReleaseFee,
  takeOffer,
  updateOfferPrice,
  updateManagedCustodianLeader,
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

type AppView = 'offers' | 'create-offer' | 'wallet' | 'donations' | 'custodian-auth' | 'guide'

const nautilusDownloadUrl = 'https://nautilus.io/'
const natriumDownloadUrl = 'https://natrium.io/'

const contactCountries = [
  { country: 'Argentina', dialCode: '+54' },
  { country: 'Bolivia', dialCode: '+591' },
  { country: 'Brasil', dialCode: '+55' },
  { country: 'Chile', dialCode: '+56' },
  { country: 'Colombia', dialCode: '+57' },
  { country: 'Costa Rica', dialCode: '+506' },
  { country: 'Cuba', dialCode: '+53' },
  { country: 'Ecuador', dialCode: '+593' },
  { country: 'El Salvador', dialCode: '+503' },
  { country: 'Espana', dialCode: '+34' },
  { country: 'Estados Unidos', dialCode: '+1' },
  { country: 'Guatemala', dialCode: '+502' },
  { country: 'Haiti', dialCode: '+509' },
  { country: 'Honduras', dialCode: '+504' },
  { country: 'Mexico', dialCode: '+52' },
  { country: 'Nicaragua', dialCode: '+505' },
  { country: 'Panama', dialCode: '+507' },
  { country: 'Paraguay', dialCode: '+595' },
  { country: 'Peru', dialCode: '+51' },
  { country: 'Republica Dominicana', dialCode: '+1' },
  { country: 'Uruguay', dialCode: '+598' },
  { country: 'Venezuela', dialCode: '+58' },
]

const initialSellerForm = {
  amountXno: '',
  currency: 'COP' as Currency,
  price: '',
  sellerCountry: 'Colombia',
  sellerDialCode: '+57',
  sellerContact: '',
}

const initialBuyerForm = {
  nanoAddress: '',
  country: 'Colombia',
  dialCode: '+57',
  contact: '',
}

const initialBuyOfferForm = {
  amountXno: '',
  currency: 'COP' as Currency,
  price: '',
  nanoAddress: '',
  country: 'Colombia',
  dialCode: '+57',
  contact: '',
}

const initialCustodianForm = {
  name: '',
  wallet: '',
  country: 'Colombia',
  dialCode: '+57',
  contact: '',
  isLeader: false,
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
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<AppView>(getInitialView)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [clientSessionId] = useState(getClientSessionId)
  const visibleOffers = takenOffer ? [takenOffer.offer] : sortOffers(offers, Boolean(custodianSession))
  const offerGroups = groupOffers(visibleOffers)
  const donationCustodian = custodians.find((custodian) => custodian.isLeader && custodian.wallet) ?? custodians.find((custodian) => custodian.wallet)
  const donationWallet = donationCustodian?.wallet ?? ''
  const donationPaymentUri = donationWallet ? `nano:${donationWallet}` : ''
  const takenOfferId = takenOffer?.offer.id
  const displayedManagedCustodians = [...managedCustodians].sort((left, right) => {
    if (left.id === custodianSession?.custodianId) return -1
    if (right.id === custodianSession?.custodianId) return 1
    if (left.isLeader && !right.isLeader) return -1
    if (!left.isLeader && right.isLeader) return 1
    return left.name.localeCompare(right.name, 'es')
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
          setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los custodios.')
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
          setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar la lista de custodios.')
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

  const updateCustodianForm = (field: keyof typeof custodianForm, value: string | boolean) => {
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
        name: custodianForm.name,
        wallet: custodianForm.wallet,
        country: custodianForm.country,
        dialCode: custodianForm.dialCode,
        contact: `${custodianForm.dialCode} ${custodianForm.contact}`.trim(),
        isLeader: custodianForm.isLeader,
      })
      setManagedCustodians(response.custodians)
      setCustodianForm(initialCustodianForm)
      await loadCustodians()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo agregar el custodio.')
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
      setError(requestError instanceof Error ? requestError.message : 'No se pudo eliminar el custodio.')
    } finally {
      setLoading(null)
    }
  }

  const handleToggleCustodianLeader = async (custodianId: string, isLeader: boolean) => {
    if (!custodianSession || !canManageCustodians) return
    setError(null)
    setLoading(`custodian-leader:${custodianId}`)

    try {
      const response = await updateManagedCustodianLeader(custodianId, custodianSession.sessionId, isLeader)
      setManagedCustodians(response.custodians)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo actualizar el lider.')
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
        sellerCountry: sellerForm.sellerCountry,
        sellerDialCode: sellerForm.sellerDialCode,
        sellerContact: sellerForm.sellerContact,
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
        buyerCountry: buyOfferForm.country,
        buyerDialCode: buyOfferForm.dialCode,
        buyerContact: buyOfferForm.contact,
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
        buyerCountry: buyerForm.country,
        buyerDialCode: buyerForm.dialCode,
        buyerContact: buyerForm.contact,
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
        setError('Autenticacion de custodio requerida.')
        return
      }
      await verifyCustodianRelease(offerId, custodianSession.sessionId)
      if (takenOffer?.offer.id === offerId) setTakenOffer(null)
      setOffers((currentOffers) => currentOffers.filter((offer) => offer.id !== offerId))
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la transferencia del custodio.')
    } finally {
      setLoading(null)
    }
  }

  const handleReleaseExpiredTakenOffer = async (offerId: string) => {
    setError(null)
    setLoading(`release-expired:${offerId}`)

    try {
      if (!custodianSession) {
        setError('Autenticacion de custodio requerida.')
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
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar la autenticacion de custodio.')
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
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la autenticacion de custodio.')
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

  const handleCancelTakenOffer = async () => {
    if (!takenOffer) return
    setError(null)
    setLoading('cancel-take')

    try {
      await cancelTakenOffer(takenOffer.offer.id, clientSessionId)
      setTakenOffer(null)
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
            <h2>Custodio</h2>
            <p>Acceso solo para cuentas autorizadas.</p>
            {custodianSession ? (
              <>
                <div className="private-box custodian-admin-box">
                  <div className="panel-heading">
                    <h3>Administrador</h3>
                  </div>
                  <div className="button-row">
                    <a className="wallet-download-link standalone-link" href="/admin/offers">
                      Ofertas
                    </a>
                    <a className="wallet-download-link standalone-link" href="/admin/nano-accounts">
                      Cuentas Nano
                    </a>
                  </div>
                </div>
                {!!managedCustodians.length && (
                  <div className="private-box custodian-admin-box">
                    <div className="panel-heading">
                      <h3>Custodio</h3>
                    </div>
                    <div className="custodian-list">
                      {displayedManagedCustodians.map((custodian) => (
                        <article className="custodian-list-item" key={custodian.id}>
                          <div>
                            <strong>{custodian.name}</strong>
                            <span>{custodian.country || 'Pais no informado'}</span>
                            <span>{custodian.contact}</span>
                            <small>{custodian.wallet}</small>
                          </div>
                          {custodian.isLeader ? (
                            <span className="offer-status-pill">Lider</span>
                          ) : !canManageCustodians ? (
                            <span className="offer-status-pill">Custodio</span>
                          ) : (
                            <span className="offer-status-pill">Custodio</span>
                          )}
                          {canManageCustodians && (
                            <div className="custodian-row-actions">
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => void handleToggleCustodianLeader(custodian.id, !custodian.isLeader)}
                                disabled={loading === `custodian-leader:${custodian.id}`}
                              >
                                {custodian.isLeader ? 'Quitar lider' : 'Marcar lider'}
                              </button>
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
                      <h3>Agregar custodio</h3>
                    </div>
                    <form className="stack-form custodian-admin-form" onSubmit={handleAddCustodian}>
                      <label>
                        Nombre
                        <input value={custodianForm.name} onChange={(event) => updateCustodianForm('name', event.target.value)} required />
                      </label>
                      <label>
                        Wallet Nano
                        <input value={custodianForm.wallet} onChange={(event) => updateCustodianForm('wallet', event.target.value)} required />
                      </label>
                      <label>
                        Pais
                        <select
                          value={custodianForm.country}
                          onChange={(event) => {
                            const selected = contactCountries.find((item) => item.country === event.target.value)
                            updateCustodianForm('country', event.target.value)
                            updateCustodianForm('dialCode', selected?.dialCode ?? '')
                          }}
                        >
                          {contactCountries.map((item) => (
                            <option key={item.country} value={item.country}>{item.country}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Contacto
                        <input value={custodianForm.contact} onChange={(event) => updateCustodianForm('contact', event.target.value)} required />
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={custodianForm.isLeader}
                          onChange={(event) => updateCustodianForm('isLeader', event.target.checked)}
                        />
                        Lider
                      </label>
                      <button className="primary-button" type="submit" disabled={loading === 'custodian-add'}>
                        Agregar custodio
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
            <p className="eyebrow">Acceso privado de custodia</p>
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
            <div className="payment-qr" aria-label="QR de autenticacion de custodio">
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
            <p>Cualquier aporte en Nano se recibe en la cuenta de administración actual.</p>
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
                  <dt>Administrador</dt>
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
            <p>El vendedor publica una oferta indicando la cantidad de XNO, el activo que recibe a cambio, la cantidad de ese activo y su número de contacto.</p>
            <p>La oferta queda visible y vinculada al equipo desde el que fue creada. Mientras nadie la tome, el vendedor puede eliminarla. Las ofertas disponibles vencen automáticamente a las 24 horas.</p>
            <p>Cuando un comprador toma la oferta, ingresa su número de contacto y la cuenta Nano donde espera recibir los fondos. Nanopaquete le informa que el vendedor está siendo notificado para depositar los XNO.</p>
            <p>El vendedor recibe la notificación, ve el botón y el QR de depósito, y deposita la cantidad publicada más el 0,2% de comisión de plataforma.</p>
            <p>Cuando el depósito queda confirmado, el vendedor ve el contacto del comprador y se le habilita el botón para confirmar el pago recibido. El comprador ve el contacto del vendedor y puede comunicarse para acordar el pago con la tranquilidad de que los XNO están en custodia.</p>
            <p>Cuando el vendedor confirma que recibió el pago, Nanopaquete transfiere los XNO a la cuenta registrada por el comprador y cierra la negociación.</p>
            <h3>Publicar compra de Nano</h3>
            <p>El comprador publica una oferta indicando la cantidad de XNO que quiere comprar, el activo que entrega a cambio, la cantidad de ese activo, su cuenta Nano receptora y su número de contacto.</p>
            <p>Cuando un vendedor toma la oferta, ingresa su número de contacto. Nanopaquete crea la cuenta Nano temporal de custodia y habilita al vendedor el botón y el QR para depositar.</p>
            <p>El vendedor deposita la cantidad de XNO de la oferta más el 0,2% de comisión de plataforma. Cuando el depósito queda confirmado, Nanopaquete notifica al comprador y muestra los números de contacto para que ambas partes acuerden el pago.</p>
            <p>Cuando el comprador paga, el vendedor confirma la recepción del pago y Nanopaquete libera los XNO a la cuenta Nano registrada por el comprador.</p>
            <h3>Posibles disputas</h3>
            <p>Si aparece una disputa durante una negociación, conserva los comprobantes y contacta al administrador de Nanopaquete al 3008188284.</p>
            <div className="guide-disputes">
              <p><strong>Una parte no responde:</strong> la otra parte debe conservar comprobantes y solicitar revisión al administrador.</p>
              <p><strong>El pago externo no se confirma:</strong> los XNO permanecen en custodia hasta que exista una confirmación suficiente o una decisión administrativa.</p>
              <p><strong>Una parte ingresó un contacto incorrecto:</strong> la revisión se hace con la información disponible en la negociación y los comprobantes que pueda aportar cada parte.</p>
              <p><strong>El comprador ingresó una cuenta Nano incorrecta:</strong> la cuenta Nano debe revisarse antes de confirmar la operación, porque la liberación se realiza hacia la cuenta registrada en la negociación.</p>
              <p><strong>Hay una falla técnica:</strong> el administrador revisa los datos de la negociación, los depósitos, los contactos y el estado de la cuenta temporal.</p>
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
                Precio total del paquete
                <input
                  placeholder="Ej. 180000"
                  value={sellerForm.price}
                  onChange={(event) => updateSellerForm('price', event.target.value)}
                  required
                />
              </label>
              <label>
                Pais del contacto
                <select
                  value={sellerForm.sellerCountry}
                  onChange={(event) => {
                    const selected = contactCountries.find((item) => item.country === event.target.value)
                    updateSellerForm('sellerCountry', event.target.value)
                    updateSellerForm('sellerDialCode', selected?.dialCode ?? '')
                  }}
                >
                  {contactCountries.map((item) => (
                    <option key={item.country} value={item.country}>{item.country}</option>
                  ))}
                </select>
              </label>
              <label>
                Contacto
                <input
                  placeholder="Ej. 3120000000"
                  value={sellerForm.sellerContact}
                  onChange={(event) => updateSellerForm('sellerContact', event.target.value)}
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
                País del contacto
                <select
                  value={buyOfferForm.country}
                  onChange={(event) => {
                    const selected = contactCountries.find((item) => item.country === event.target.value)
                    updateBuyOfferForm('country', event.target.value)
                    updateBuyOfferForm('dialCode', selected?.dialCode ?? '')
                  }}
                >
                  {contactCountries.map((item) => (
                    <option key={item.country} value={item.country}>{item.country}</option>
                  ))}
                </select>
              </label>
              <label>
                Contacto
                <input
                  placeholder="Ej. 3120000000"
                  value={buyOfferForm.contact}
                  onChange={(event) => updateBuyOfferForm('contact', event.target.value)}
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
                    <small>Estado: {offer.status === 'ACTIVE' ? 'Activa' : offer.status === 'NEGOTIATION' ? 'En negociacion' : 'Liberando'}</small>
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
                  {offer.canDepositNano && (
                    <button
                      type="button"
                      onClick={() => void handleStartReleaseFee(offer.id)}
                      disabled={loading === `release-start:${offer.id}`}
                    >
                      Depositar Nano
                    </button>
                  )}
                  {offer.canConfirmPayment && (
                    <button
                      type="button"
                      onClick={() => void handleConfirmSellerPayment(offer.id)}
                      disabled={loading === `confirm-payment:${offer.id}`}
                    >
                      Confirmar pago recibido
                    </button>
                  )}
                  {releaseFeeIntent?.offerId === offer.id && (
                    <div className="private-box release-fee-box inline-release-fee-box">
                      <p className="eyebrow">Deposito de Nano</p>
                      <h3>Deposita {releaseFeeIntent.amountXno} XNO en la custodia.</h3>
                      <p>Cuando la app detecte esa transferencia, se mostraran los datos de contacto para continuar la negociacion.</p>
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
                          ? 'Deposita los XNO para ver los datos de contacto y continuar la negociación.'
                          : 'Espera la confirmación del depósito Nano para ver los datos de contacto y continuar la negociación.'}
                      </p>
                    </div>
                  )}
                  {offer.status === 'NEGOTIATION' && offer.isPublishedOffer && (
                    (offer.offerType === 'SELL' && offer.buyerContact) ||
                    (offer.offerType === 'BUY' && offer.sellerContact)
                  ) && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">Persona que tomó esta oferta</p>
                      <dl>
                        <dt>Pais</dt>
                        <dd>{offer.offerType === 'BUY' ? offer.sellerCountry || 'No informado' : offer.buyerCountry || 'No informado'}</dd>
                        <dt>Contacto</dt>
                        <dd>
                          {offer.offerType === 'BUY'
                            ? `${offer.sellerDialCode ? offer.sellerDialCode + ' ' : ''}${offer.sellerContact}`
                            : `${offer.buyerDialCode ? offer.buyerDialCode + ' ' : ''}${offer.buyerContact}`}
                        </dd>
                      </dl>
                    </div>
                  )}
                  {custodianSession && offer.status === 'NEGOTIATION' && offer.sellerContact && offer.buyerContact && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">Contactos para disputa</p>
                      <dl>
                        <dt>Pais vendedor</dt>
                        <dd>{offer.sellerCountry || 'No informado'}</dd>
                        <dt>Contacto vendedor</dt>
                        <dd>{offer.sellerDialCode ? offer.sellerDialCode + ' ' : ''}{offer.sellerContact}</dd>
                        <dt>Pais comprador</dt>
                        <dd>{offer.buyerCountry || 'No informado'}</dd>
                        <dt>Contacto comprador</dt>
                        <dd>{offer.buyerDialCode ? offer.buyerDialCode + ' ' : ''}{offer.buyerContact}</dd>
                      </dl>
                      {offer.canCustodianReleaseOffer && (
                        <button
                          className="ghost-button danger-button"
                          type="button"
                          onClick={() => void handleReleaseExpiredTakenOffer(offer.id)}
                          disabled={loading === `release-expired:${offer.id}`}
                        >
                          <X size={16} />
                          {loading === `release-expired:${offer.id}` ? 'Liberando...' : 'Liberar oferta'}
                        </button>
                      )}
                    </div>
                  )}
                  {offer.status === 'RELEASING' && !offer.canCustodianReleaseFunds && (
                    <span className="offer-status-pill">Liberando</span>
                  )}
                  {offer.canCustodianReleaseFunds && (
                    <div className="private-box custodian-release-box">
                      <span className="offer-status-pill">Liberando</span>
                      <h3>Transferencia del custodio</h3>
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
                      <label>
                        Pais del contacto
                        <select
                          value={buyerForm.country}
                          onChange={(event) => {
                            const selected = contactCountries.find((item) => item.country === event.target.value)
                            updateBuyerForm('country', event.target.value)
                            updateBuyerForm('dialCode', selected?.dialCode ?? '')
                          }}
                        >
                          {contactCountries.map((item) => (
                            <option key={item.country} value={item.country}>{item.country}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Contacto
                        <input
                          placeholder="Ej. 3120000000"
                          value={buyerForm.contact}
                          onChange={(event) => updateBuyerForm('contact', event.target.value)}
                          required
                        />
                      </label>
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
              <p className="eyebrow">{takenOffer.offer.status === 'RELEASING' ? 'Pago confirmado' : 'Negociación iniciada'}</p>
              {takenOffer.offer.status === 'RELEASING' ? (
                <>
                  <h3>El vendedor ya confirmó que recibió el pago.</h3>
                  <p>La liberación de los XNO está pendiente de Nanopaquete. Si se tarda, comunícate con el administrador para consultar el estado.</p>
                </>
              ) : !takenOffer.offer.sellerDepositConfirmed && takenOffer.offer.offerType === 'SELL' ? (
                <>
                  <h3>La oferta fue tomada y el vendedor debe depositar los XNO.</h3>
                  <p>Espera la confirmación del depósito antes de enviar el pago externo. Usa el contacto del administrador si el proceso se queda detenido.</p>
                </>
              ) : !takenOffer.offer.sellerDepositConfirmed ? (
                <>
                  <h3>Deposita los XNO para iniciar la negociación.</h3>
                  <p>Después de confirmar el depósito, se mostrarán los datos del comprador para acordar el pago externo.</p>
                </>
              ) : (
                <>
                  <h3>{takenOffer.offer.offerType === 'BUY' ? 'Comunícate con el comprador para acordar el pago.' : 'Comunícate con el vendedor para acordar cómo harás el pago.'}</h3>
                  <p>{takenOffer.offer.offerType === 'BUY' ? 'Los XNO ya están bloqueados en custodia. Confirma el pago recibido cuando el comprador complete el pago externo.' : 'Los XNO de esta oferta ya están bloqueados en custodia. El vendedor solo puede liberar a la cuenta que registraste cuando reciba el pago.'}</p>
                  <p>Usa el contacto del administrador solo si ocurre un contratiempo que no puedas solucionar directamente con la otra parte.</p>
                </>
              )}
              <dl>
                {takenOffer.offer.status === 'NEGOTIATION' && takenOffer.offer.sellerDepositConfirmed && (
                  <>
                    <dt>{takenOffer.offer.offerType === 'BUY' ? 'Pais comprador' : 'Pais vendedor'}</dt>
                    <dd>{takenOffer.offer.offerType === 'BUY' ? takenOffer.buyerCountry || 'No informado' : takenOffer.sellerCountry || 'No informado'}</dd>
                    <dt>{takenOffer.offer.offerType === 'BUY' ? 'Contacto comprador' : 'Contacto vendedor'}</dt>
                    <dd>
                      {takenOffer.offer.offerType === 'BUY'
                        ? `${takenOffer.buyerDialCode ? takenOffer.buyerDialCode + ' ' : ''}${takenOffer.buyerContact}`
                        : `${takenOffer.sellerDialCode ? takenOffer.sellerDialCode + ' ' : ''}${takenOffer.sellerContact}`}
                    </dd>
                  </>
                )}
                <dt>Contacto administrador</dt>
                <dd>{takenOffer.custodianContact}</dd>
                <dt>Oferta tomada</dt>
                <dd>{takenOffer.offer.amountXno} XNO por {takenOffer.offer.price} {takenOffer.offer.currency}</dd>
              </dl>
              {takenOffer.offer.status === 'NEGOTIATION' && !takenOffer.offer.sellerDepositConfirmed && (
                <button
                  className="ghost-button danger-button"
                  type="button"
                  onClick={handleCancelTakenOffer}
                  disabled={loading === 'cancel-take'}
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
