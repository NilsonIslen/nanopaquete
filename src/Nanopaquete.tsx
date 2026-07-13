import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, PackageCheck, ShieldCheck, Wallet, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  cancelTakenOffer,
  getBuyerNegotiation,
  getCustodians,
  getOffers,
  publishOffer,
  startCustodianAuth,
  startReleaseFee,
  startSellerPayment,
  takeOffer,
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
    return value ? (JSON.parse(value) as SellerPaymentIntent) : null
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
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientSessionId] = useState(getClientSessionId)
  const visibleOffers = takenOffer ? [takenOffer.offer] : offers

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
            <PackageCheck size={26} />
          </span>
          <div>
            <h1>Nanopaquete</h1>
            <p className="topbar-subtitle">Custodia de Nano para comercio P2P</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className={custodianSession ? 'icon-button active-custodian-button' : 'icon-button'}
            type="button"
            onClick={custodianSession ? undefined : handleStartCustodianAuth}
            disabled={loading === 'custodian-auth-start'}
            aria-label={custodianSession ? `Custodio autenticado: ${custodianSession.custodianName}` : 'Acceso custodio autorizado'}
            title={custodianSession ? `Custodio autenticado: ${custodianSession.custodianName}` : 'Acceso custodio autorizado'}
          >
            <ShieldCheck size={20} />
          </button>
          {custodianSession && (
            <button className="icon-button" type="button" onClick={() => void handleCloseCustodianSession()} aria-label="Cerrar sesion custodio" title="Cerrar sesion custodio">
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      {custodianAuthIntent && (
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

      <section className="work-grid">
        <div className="panel seller-panel">
          <div className="panel-heading">
            <h2>Crear oferta</h2>
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
              <button className="primary-button" type="button" onClick={handleStartSellerPayment} disabled={loading === 'start-payment' || !selectedCustodianId}>
                <Wallet size={18} />
                Iniciar deposito
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
                Cancelar
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
                  {!isSelected && offer.status === 'ACTIVE' && (
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
              <p className="eyebrow">Negociacion iniciada</p>
              <h3>Comunicate con el vendedor para acordar como haras el pago.</h3>
              <p>Los XNO de esta oferta ya estan bloqueados en custodia. El vendedor solo puede liberar a la cuenta que registraste cuando reciba el pago.</p>
              <dl>
                <dt>Pais vendedor</dt>
                <dd>{takenOffer.sellerCountry || 'No informado'}</dd>
                <dt>Contacto vendedor</dt>
                <dd>{takenOffer.sellerDialCode ? takenOffer.sellerDialCode + ' ' : ''}{takenOffer.sellerContact}</dd>
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
      </section>
    </main>
  )
}
