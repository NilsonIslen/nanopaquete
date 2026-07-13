import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, Download, Menu, ShieldCheck, Wallet, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  cancelTakenOffer,
  getBuyerNegotiation,
  getCustodians,
  getOffers,
  publishOffer,
  releaseExpiredTakenOffer,
  startCustodianAuth,
  startReleaseFee,
  startSellerPayment,
  takeOffer,
  updateOfferPrice,
  verifyCustodianAuth,
  verifyCustodianRelease,
  verifyReleaseFee,
  verifySellerPayment,
  type Currency,
  type CustodianAuthIntent,
  type CustodianOption,
  type CustodianSession,
  type EscrowSession,
  type PublicOffer,
  type PublishedOffer,
  type ReleaseFeeIntent,
  type SellerPaymentIntent,
  type TakenOffer,
} from './api'
import './Nanopaquete.css'

const currencies: Currency[] = ['COP', 'USD', 'BTC', 'EUR']

type AppView = 'offers' | 'create-offer' | 'wallet' | 'custodian-auth' | 'guide'

const nautilusDownloadUrl = 'https://nautilus.io/'

const contactCountries = [
  { country: 'Colombia', dialCode: '+57' },
  { country: 'Estados Unidos', dialCode: '+1' },
  { country: 'Mexico', dialCode: '+52' },
  { country: 'Argentina', dialCode: '+54' },
  { country: 'Chile', dialCode: '+56' },
  { country: 'Peru', dialCode: '+51' },
  { country: 'Venezuela', dialCode: '+58' },
  { country: 'Espana', dialCode: '+34' },
  { country: 'Otro', dialCode: '' },
]

const initialSellerForm = {
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

const sellerPaymentStorageKey = 'nanopaquete:seller-payment'
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

const getStoredSellerPayment = () => {
  try {
    const value = window.localStorage.getItem(sellerPaymentStorageKey)
    const payment = value ? (JSON.parse(value) as SellerPaymentIntent) : null
    return payment && new Date(payment.expiresAt).getTime() > Date.now() ? payment : null
  } catch {
    return null
  }
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

const NanoLogo = () => (
  <svg className="nano-logo" viewBox="0 0 42 42" role="img" aria-label="Nano">
    <path d="M13 21h16M16 15l10 12M26 15 16 27" />
    <rect x="8.8" y="16.8" width="8.4" height="8.4" />
    <rect x="24.8" y="16.8" width="8.4" height="8.4" />
    <rect x="11.8" y="10.8" width="8.4" height="8.4" />
    <rect x="21.8" y="10.8" width="8.4" height="8.4" />
    <rect x="11.8" y="22.8" width="8.4" height="8.4" />
    <rect x="21.8" y="22.8" width="8.4" height="8.4" />
  </svg>
)

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

export function Nanopaquete() {
  const [sellerForm, setSellerForm] = useState(initialSellerForm)
  const [sellerPayment, setSellerPayment] = useState<SellerPaymentIntent | null>(getStoredSellerPayment)
  const [escrowSession, setEscrowSession] = useState<EscrowSession | null>(null)
  const [publishedOffer, setPublishedOffer] = useState<PublishedOffer | null>(null)
  const [offers, setOffers] = useState<PublicOffer[]>([])
  const [custodians, setCustodians] = useState<CustodianOption[]>([])
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
  const [activeView, setActiveView] = useState<AppView>('offers')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [clientSessionId] = useState(getClientSessionId)
  const visibleOffers = takenOffer ? [takenOffer.offer] : sortOffers(offers, Boolean(custodianSession))
  const takenOfferId = takenOffer?.offer.id

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
    if (sellerPayment) {
      window.localStorage.setItem(sellerPaymentStorageKey, JSON.stringify(sellerPayment))
      return
    }

    window.localStorage.removeItem(sellerPaymentStorageKey)
  }, [sellerPayment])

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

  const updateSellerForm = (field: keyof typeof sellerForm, value: string) => {
    setSellerForm((current) => ({ ...current, [field]: value }))
  }

  const updateBuyerForm = (field: keyof typeof buyerForm, value: string) => {
    setBuyerForm((current) => ({ ...current, [field]: value }))
  }

  const handleStartSellerPayment = async () => {
    setError(null)
    setPublishedOffer(null)
    setEscrowSession(null)
    setLoading('start-payment')

    try {
      const intent = await startSellerPayment(clientSessionId, selectedCustodianId)
      setSellerPayment(intent)
      setActiveView('create-offer')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar el deposito.')
    } finally {
      setLoading(null)
    }
  }


  const handleCancelSellerPayment = () => {
    setSellerPayment(null)
    setError(null)
  }

  const handleVerifySellerPayment = async () => {
    if (!sellerPayment) return
    setError(null)
    setLoading('verify-payment')

    try {
      const session = await verifySellerPayment(sellerPayment.intentId, clientSessionId)
      setEscrowSession(session)
      setSellerPayment(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'El deposito aun no fue confirmado.')
    } finally {
      setLoading(null)
    }
  }

  const handlePublishSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!escrowSession) return
    setError(null)
    setLoading('publish')

    try {
      const response = await publishOffer({
        escrowId: escrowSession.escrowId,
        publishToken: escrowSession.publishToken,
        currency: sellerForm.currency,
        price: sellerForm.price,
        sellerCountry: sellerForm.sellerCountry,
        sellerDialCode: sellerForm.sellerDialCode,
        sellerContact: sellerForm.sellerContact,
      })
      setPublishedOffer(response)
      setEscrowSession(null)
      setSellerForm(initialSellerForm)
      setActiveView('offers')
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo publicar la oferta.')
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
        buyerNanoAddress: buyerForm.nanoAddress,
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
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar la liberacion.')
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
      setError(requestError instanceof Error ? requestError.message : 'No se pudo validar la comision de liberacion.')
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
      const intent = await startCustodianAuth(selectedCustodianId)
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
    setCustodianSession(null)
    setCustodianAuthIntent(null)
    window.localStorage.removeItem(custodianSessionStorageKey)
    setError(null)

    try {
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
            <NanoLogo />
          </span>
          <div>
            <h1>Nanopaquete</h1>
            <p className="topbar-subtitle">Custodia de Nano para comercio P2P</p>
          </div>
        </div>
        <div className="topbar-actions menu-area">
          <button className="icon-button" type="button" onClick={() => setIsMenuOpen((current) => !current)} aria-label="Abrir menu" title="Menu">
            <Menu size={20} />
          </button>
          {isMenuOpen && (
            <div className="app-menu">
              <button type="button" onClick={() => { setActiveView('create-offer'); setIsMenuOpen(false) }}>Crear oferta</button>
              <button type="button" onClick={() => { setActiveView('wallet'); setIsMenuOpen(false) }}>Descargar wallet (Nautilus)</button>
              <button type="button" onClick={() => { setActiveView('custodian-auth'); setIsMenuOpen(false) }}>Autenticacion custodio</button>
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
            <h2>Autenticacion custodio</h2>
            <p>Acceso solo para cuentas autorizadas.</p>
            {custodianSession ? (
              <div className="private-box">
                <p>Custodio autenticado: <strong>{custodianSession.custodianName}</strong></p>
                <button className="ghost-button danger-button" type="button" onClick={() => void handleCloseCustodianSession()}>
                  <X size={16} />
                  Cerrar sesion
                </button>
              </div>
            ) : (
              <button className="primary-button" type="button" onClick={handleStartCustodianAuth} disabled={loading === 'custodian-auth-start' || !selectedCustodianId}>
                <ShieldCheck size={18} />
                Iniciar autenticacion
              </button>
            )}
          </div>
        </section>
      )}

      {activeView === 'custodian-auth' && custodianAuthIntent && (
        <section className="intro-band compact-intro-band auth-panel-band">
          <div className="private-box custodian-auth-box">
            <p className="eyebrow">Acceso solo para cuentas autorizadas</p>
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
            <p>Nautilus es un monedero para Nano. Te permite recibir, guardar y enviar tus XNO desde el celular, y lo necesitas para copiar tu direccion o abrir los pagos que genera Nanopaquete.</p>
            <p>Instalalo antes de comprar o vender para tener lista la wallet donde recibiras o desde donde enviaras Nano.</p>
            <a className="wallet-download-link standalone-link" href={nautilusDownloadUrl} target="_blank" rel="noreferrer">
              <Download size={17} />
              Abrir Nautilus
            </a>
          </div>
        </section>
      )}

      {activeView === 'guide' && (
        <section className="single-page-panel">
          <div className="panel guide-panel">
            <h2>Guía</h2>
            <h3>Condiciones generales</h3>
            <p>Nanopaquete organiza negociaciones P2P con custodia Nano. La plataforma no persigue el precio del mercado: cada vendedor define cuánto espera recibir por su paquete de XNO y cada comprador decide qué oferta tomar. Esa competencia interna ayuda a evitar precios inflados o devaluados, siempre bajo el criterio de quienes poseen y demandan Nano.</p>
            <h3>Vendedor</h3>
            <p>El vendedor publica una oferta de Nano. Para hacerlo, primero debe transferir al custodio seleccionado el monto exacto de XNO que quiere vender.</p>
            <p>Cuando Nanopaquete detecta la transferencia, habilita un formulario para indicar qué activo espera recibir a cambio y el precio de su paquete. Después de publicar, solo puede editar el precio.</p>
            <p>Si el vendedor necesita retirar los fondos de una oferta publicada, debe simular una compra desde un equipo distinto al que usó para publicarla. En ese proceso también debe pagar los 0.1 XNO al custodio para que los fondos puedan liberarse.</p>
            <p>Cuando un comprador toma una oferta, esta queda bloqueada junto con sus fondos. El vendedor recibe la información de contacto del comprador y solo puede liberar esos XNO hacia la wallet registrada por ese comprador.</p>
            <p>Cuando recibe el pago acordado, el vendedor lo confirma desde la plataforma mediante una transferencia de 0.1 XNO al custodio. Esa confirmación habilita al custodio para liberar los fondos exclusivamente al comprador.</p>
            <h3>Comprador</h3>
            <p>El comprador es cualquier persona que toma una de las ofertas publicadas. Al hacerlo, ingresa la dirección Nano donde quiere recibir los fondos y su número de contacto.</p>
            <p>Después de enviar esa información, recibe el contacto del vendedor para comunicarse y acordar cómo realizar el pago. Durante la negociación, los XNO quedan bajo custodia para que pueda pagar con mayor tranquilidad.</p>
            <p>Es importante guardar el comprobante de pago en caso de conflicto y verificar muy bien la dirección Nano y el contacto ingresados. Si el comprador registra datos incorrectos y el custodio no puede comunicarse con él, el custodio dará prioridad a la parte con la que sí sea posible establecer comunicación.</p>
            <h3>Custodio</h3>
            <p>El custodio es una persona de confianza directa de la plataforma y forma parte de un grupo de custodios que sirven como intermediarios en las negociaciones.</p>
            <p>En condiciones normales, el proceso es automático: cuando el vendedor confirma que recibió el pago, el custodio solo libera los fondos al comprador desde la opción habilitada, sin validaciones adicionales.</p>
            <p>El custodio interviene cuando hay conflicto. En ese caso solicita comprobantes, revisa la situación y decide si libera los fondos al comprador o libera la oferta según corresponda.</p>
            <p>Cada custodio recibe 0.1 XNO por intermediación, pagados por el vendedor al confirmar que recibió el pago de su contraparte.</p>
            <p>Si un usuario pierde dinero por equivocación o mala fe de un custodio, los demás custodios deben reponer la pérdida del usuario y determinar si el custodio responsable continúa o es expulsado.</p>
            <h3>Líder</h3>
            <p>El líder intermedia entre custodios y desarrolladores para mantener la plataforma funcionando y en constante actualización. También incluye o expulsa custodios a nivel técnico según las solicitudes del grupo.</p>
            <p>El líder también es custodio y tiene las mismas posibilidades de recibir ingresos que los demás custodios. Su trabajo adicional como líder es un aporte voluntario y no recibe pago extra por esa función, conservando la naturaleza de Nano: personas que aportan a la red por principios propios y convicción sobre el proyecto.</p>
            <p>Contacto del líder: <strong>+573008188284</strong>.</p>
            <h3>Posibles disputas</h3>
            <div className="guide-disputes">
              <p><strong>El comprador no responde:</strong> el vendedor debe intentar comunicarse con el comprador para que pague o libere la oferta. Si pasan 24 horas sin respuesta, el vendedor puede solicitar al custodio que libere la oferta para que vuelva a estar visible.</p>
              <p><strong>El comprador responde, pero no paga después de 24 horas:</strong> se le solicita que libere la oferta. Si no atiende la solicitud, el vendedor informa al custodio. Tras revisar el caso, el custodio libera la oferta y reporta el contacto y la dirección Nano al líder para agregarlos a una lista negativa que impida negociar nuevamente con esos datos.</p>
              <p><strong>El comprador paga, pero el vendedor no confirma:</strong> el comprador debe reportar el caso al custodio y enviar el comprobante de pago. El custodio revisa el soporte, se comunica con el vendedor y solicita la confirmación. Si el vendedor no atiende y el custodio identifica que el pago sí fue realizado, libera los fondos al comprador sin recibir comisión y reporta el contacto y la dirección Nano del vendedor a la lista negativa. Si el vendedor tiene más ofertas publicadas, se cierran y se le devuelven los XNO descontando el valor de la comisión.</p>
              <p><strong>El comprador ingresó un contacto incorrecto:</strong> si no es posible establecer comunicación con el comprador, este debe cancelar la solicitud para liberar la publicación y tomarla de nuevo con los datos correctos.</p>
              <p><strong>El comprador ingresó una cuenta Nano incorrecta:</strong> si lo detecta antes de la liberación, debe cancelar la solicitud y tomar la oferta nuevamente con la cuenta correcta. Si el proceso llega hasta el final y los fondos son liberados a una cuenta distinta, el comprador pierde el dinero y los fondos.</p>
              <p><strong>El vendedor ingresó un contacto incorrecto:</strong> debe simular una compra desde otro equipo para cerrar la oferta y abrir una nueva con los datos correctos. La cuenta Nano del vendedor no debería fallar, porque se registra en el momento en que deposita los fondos.</p>
              <p><strong>Hay una falla técnica al registrar los fondos del vendedor:</strong> el caso debe reportarse al líder para que lo revise junto con los custodios. Si la falla causa una pérdida, el líder y los custodios deben coordinar la reposición correspondiente.</p>
              <p><strong>El custodio toma una decisión equivocada y una parte pierde dinero:</strong> el usuario afectado puede comunicarse con el líder. El líder revisa el caso con el custodio y, si confirma la equivocación, solicita que reponga el saldo del usuario. Si el custodio no responde, el caso se presenta al grupo de custodios, quienes deben reunir el saldo para reponer al usuario. El custodio responsable queda expulsado.</p>
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
            <p>Vas a poner en venta la cantidad de XNO que deposites en custodia. Primero transfiere el monto exacto al custodio seleccionado; cuando Nanopaquete detecte el depósito, podrás indicar qué activo y cuánto esperas recibir a cambio.</p>
          </div>

          {!sellerPayment && !escrowSession && (
            <div className="deposit-start">
              <label>
                Custodio
                <select
                  value={selectedCustodianId}
                  onChange={(event) => setSelectedCustodianId(event.target.value)}
                  disabled={!custodians.length}
                >
                  {custodians.map((custodian) => (
                    <option key={custodian.id} value={custodian.id}>{custodian.name}</option>
                  ))}
                </select>
              </label>
              <p>
                Transfiere a la cuenta de custodia la cantidad exacta de XNO que quieres vender.
              </p>
              <button className="primary-button create-offer-button" type="button" onClick={handleStartSellerPayment} disabled={loading === 'start-payment' || !selectedCustodianId}>
                <Wallet size={18} />
                Crear oferta
              </button>
            </div>
          )}

          {sellerPayment && (
            <div className="private-box payment-box">
              <p className="eyebrow">Deposito de custodia</p>
              <div className="payment-actions">
                <button className="primary-button" type="button" onClick={() => openNanoPayment(sellerPayment.paymentUri)}>
                  <Wallet size={18} />
                  Pagar desde el movil
                </button>
                <button className="ghost-button" type="button" onClick={() => void copyValue(sellerPayment.receiverAddress)}>
                  <Copy size={16} />
                  Copiar wallet
                </button>
              </div>
              <div className="payment-qr" aria-label="QR de pago Nano">
                <QRCodeSVG value={sellerPayment.paymentUri} size={176} marginSize={2} />
              </div>
              <dl>
                <dt>Custodio seleccionado</dt>
                <dd>{sellerPayment.custodianName}</dd>
                <dt>Wallet custodia</dt>
                <dd>{sellerPayment.receiverAddress}</dd>
                <dt>Sesion local</dt>
                <dd>{clientSessionId.slice(0, 8)}</dd>
                <dt>Vence</dt>
                <dd>{shortDate(sellerPayment.expiresAt)}</dd>
                <dt>Contacto custodio</dt>
                <dd>{sellerPayment.custodianContact}</dd>
              </dl>
              <button className="primary-button" type="button" onClick={handleVerifySellerPayment} disabled={loading === 'verify-payment'}>
                Verificar deposito
              </button>
              <button className="ghost-button danger-button" type="button" onClick={handleCancelSellerPayment}>
                <X size={16} />
                Cancelar y elegir otro custodio
              </button>
            </div>
          )}

          {escrowSession && (
            <div className="private-box verified-box">
              <p className="eyebrow">Deposito confirmado</p>
              <div className="custodian-alert">
                <span>Custodio para disputa y liberacion</span>
                <strong>{escrowSession.custodianContact}</strong>
                <button type="button" onClick={() => void copyValue(escrowSession.custodianContact)}>
                  <Copy size={16} />
                  Copiar
                </button>
                <p>Conserva este contacto. Si el comprador no paga o hay disputa, el custodio es quien puede mantener bloqueada, cancelar o liberar la publicacion con fondos.</p>
              </div>
              <dl>
                <dt>Cantidad en venta</dt>
                <dd>{escrowSession.amountXno} XNO</dd>
                <dt>Wallet origen</dt>
                <dd>{escrowSession.sellerWallet}</dd>
                <dt>Hash deposito</dt>
                <dd>{escrowSession.paymentHash}</dd>
                <dt>Comision de liberacion</dt>
                <dd>{escrowSession.custodyFeeXno} XNO</dd>
              </dl>
            </div>
          )}

          {escrowSession && (
            <form className="stack-form publish-form" onSubmit={handlePublishSubmit}>
              <label>
                Divisa
                <select
                  value={sellerForm.currency}
                  onChange={(event) => updateSellerForm('currency', event.target.value as Currency)}
                >
                  {currencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <label>
                Precio esperado
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
                Extension internacional
                <input
                  placeholder="+57"
                  value={sellerForm.sellerDialCode}
                  onChange={(event) => updateSellerForm('sellerDialCode', event.target.value)}
                  required
                />
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
              <button className="primary-button" type="submit" disabled={loading === 'publish'}>
                Publicar oferta
              </button>
            </form>
          )}

          {publishedOffer && (
            <div className="status-message success">
              Oferta publicada. Codigo privado del vendedor: <strong>{publishedOffer.sellerPrivateCode}</strong>
            </div>
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
            {visibleOffers.map((offer) => {
              const isSelected = selectedOffer?.id === offer.id

              return (
                <article className={isSelected ? 'offer-card selected-offer-card' : 'offer-card'} key={offer.id}>
                  <div>
                    <p className="offer-amount">{offer.amountXno} XNO</p>
                    <p>{offer.price} {offer.currency}</p>
                    <small>Estado: {offer.status === 'ACTIVE' ? 'Activa' : offer.status === 'NEGOTIATION' ? 'En negociacion' : 'Liberando'}</small>
                    <small>Publicada {shortDate(offer.createdAt)}</small>
                  </div>
                  {offer.canEditPrice && editingPriceOfferId !== offer.id && (
                    <button type="button" onClick={() => handleStartEditPrice(offer)}>
                      Editar precio
                    </button>
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
                  {offer.canConfirmPayment && (
                    <button
                      type="button"
                      onClick={() => void handleStartReleaseFee(offer.id)}
                      disabled={loading === `release-start:${offer.id}`}
                    >
                      Confirmar pago
                    </button>
                  )}
                  {offer.canConfirmPayment && offer.buyerContact && (
                    <div className="private-box seller-buyer-box">
                      <p className="eyebrow">Comprador de esta oferta</p>
                      <dl>
                        <dt>Pais comprador</dt>
                        <dd>{offer.buyerCountry || 'No informado'}</dd>
                        <dt>Contacto comprador</dt>
                        <dd>{offer.buyerDialCode ? offer.buyerDialCode + ' ' : ''}{offer.buyerContact}</dd>
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
                  {offer.status === 'RELEASING' && !offer.custodianReleaseUri && (
                    <span className="offer-status-pill">Liberando</span>
                  )}
                  {offer.status === 'RELEASING' && offer.custodianReleaseUri && (
                    <div className="private-box custodian-release-box">
                      <span className="offer-status-pill">Liberando</span>
                      <h3>Transferencia del custodio</h3>
                      <p>Esta oferta ya fue confirmada por el vendedor. El custodio puede usar este enlace para liberar los fondos al comprador.</p>
                      <div className="payment-actions">
                            <button className="primary-button" type="button" onClick={() => openNanoPayment(offer.custodianReleaseUri || '')}>
                              <Wallet size={18} />
                              Transferir al comprador
                            </button>
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={() => void handleVerifyCustodianRelease(offer.id)}
                              disabled={loading === `custodian-release:${offer.id}`}
                            >
                              <CheckCircle2 size={16} />
                              {loading === `custodian-release:${offer.id}` ? 'Verificando...' : 'Verificar liberacion'}
                            </button>
                      </div>
                      <div className="payment-qr" aria-label="QR para transferir al comprador">
                        <QRCodeSVG value={offer.custodianReleaseUri} size={176} marginSize={2} />
                      </div>
                    </div>
                  )}
                  {!isSelected && offer.status === 'ACTIVE' && !offer.isOwnOffer && (
                    <button
                      type="button"
                      onClick={() => {
                        if (takenOffer) {
                          setError('Ya tienes una negociacion abierta. Cancela o cierra esa negociacion antes de tomar otra oferta.')
                          return
                        }
                        setSelectedOffer(offer)
                      }}
                    >
                      Tomar oferta
                    </button>
                  )}
                  {releaseFeeIntent?.offerId === offer.id && (
                    <div className="private-box release-fee-box inline-release-fee-box">
                      <p className="eyebrow">Confirmar pago recibido</p>
                      <h3>Paga {releaseFeeIntent.amountXno} XNO desde la wallet vendedora a la custodia.</h3>
                      <p>Cuando la app detecte esa transferencia, la oferta pasara a estado liberando y el custodio podra enviar los fondos a la wallet registrada por el comprador.</p>
                      <div className="payment-actions">
                        <button className="primary-button" type="button" onClick={() => openNanoPayment(releaseFeeIntent.paymentUri)}>
                          <Wallet size={18} />
                          Pagar comision
                        </button>
                        <button className="ghost-button" type="button" onClick={() => void copyValue(releaseFeeIntent.receiverAddress)}>
                          <Copy size={16} />
                          Copiar custodia
                        </button>
                      </div>
                      <div className="payment-qr" aria-label="QR de comision de liberacion">
                        <QRCodeSVG value={releaseFeeIntent.paymentUri} size={176} marginSize={2} />
                      </div>
                      <dl>
                        <dt>Desde wallet</dt>
                        <dd>{releaseFeeIntent.senderWallet}</dd>
                        <dt>Hacia custodia</dt>
                        <dd>{releaseFeeIntent.receiverAddress}</dd>
                        <dt>Monto</dt>
                        <dd>{releaseFeeIntent.amountXno} XNO</dd>
                      </dl>
                      <button className="primary-button" type="button" onClick={handleVerifyReleaseFee} disabled={loading === 'release-verify'}>
                        Verificar comision
                      </button>
                      <button className="ghost-button danger-button" type="button" onClick={() => setReleaseFeeIntent(null)}>
                        <X size={16} />
                        Cerrar
                      </button>
                    </div>
                  )}
                  {isSelected && (
                    <form className="take-form inline-take-form" onSubmit={handleTakeOffer}>
                      <div>
                        <p className="eyebrow">Tomar oferta</p>
                        <h3>{offer.amountXno} XNO por {offer.price} {offer.currency}</h3>
                      </div>
                      <label>
                        Wallet nano donde recibiras los XNO
                        <input
                          placeholder="nano_..."
                          value={buyerForm.nanoAddress}
                          onChange={(event) => updateBuyerForm('nanoAddress', event.target.value)}
                          required
                          autoFocus
                        />
                      </label>
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
                        Extension internacional
                        <input
                          placeholder="+57"
                          value={buyerForm.dialCode}
                          onChange={(event) => updateBuyerForm('dialCode', event.target.value)}
                          required
                        />
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
            {!visibleOffers.length && <p className="empty-state">No hay ofertas activas en este momento.</p>}
          </div>


          {takenOffer && (
            <div className="private-box buyer-result">
              <p className="eyebrow">{takenOffer.offer.status === 'RELEASING' ? 'Pago confirmado' : 'Negociación iniciada'}</p>
              {takenOffer.offer.status === 'RELEASING' ? (
                <>
                  <h3>El vendedor ya confirmó que recibió el pago.</h3>
                  <p>La liberación de los XNO está pendiente del custodio. Si se tarda, comunícate con el custodio para consultar el estado.</p>
                </>
              ) : (
                <>
                  <h3>Comunícate con el vendedor para acordar cómo harás el pago.</h3>
                  <p>Los XNO de esta oferta ya están bloqueados en custodia. El vendedor solo puede liberar a la cuenta que registraste cuando reciba el pago.</p>
                  <p>Usa el contacto del custodio solo si ocurre un contratiempo que no puedas solucionar directamente con el vendedor.</p>
                </>
              )}
              <dl>
                <dt>Pais vendedor</dt>
                <dd>{takenOffer.sellerCountry || 'No informado'}</dd>
                <dt>Contacto vendedor</dt>
                <dd>{takenOffer.sellerDialCode ? takenOffer.sellerDialCode + ' ' : ''}{takenOffer.sellerContact}</dd>
                <dt>Contacto custodio</dt>
                <dd>{takenOffer.custodianContact}</dd>
                <dt>Oferta tomada</dt>
                <dd>{takenOffer.offer.amountXno} XNO por {takenOffer.offer.price} {takenOffer.offer.currency}</dd>
              </dl>
              {takenOffer.offer.status === 'NEGOTIATION' && (
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
