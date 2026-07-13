import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  cancelTakenOffer,
  getOffers,
  publishOffer,
  startSellerPayment,
  takeOffer,
  verifySellerPayment,
  type Currency,
  type EscrowSession,
  type PublicOffer,
  type PublishedOffer,
  type SellerPaymentIntent,
  type TakenOffer,
} from './api'
import './Nanopaquete.css'

const currencies: Currency[] = ['COP', 'USD', 'BTC', 'EUR']

const initialSellerForm = {
  currency: 'COP' as Currency,
  price: '',
  sellerContact: '',
}

const sellerPaymentStorageKey = 'nanopaquete:seller-payment'
const takenOfferStorageKey = 'nanopaquete:taken-offer'
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
  const [selectedOffer, setSelectedOffer] = useState<PublicOffer | null>(null)
  const [buyerNanoAddress, setBuyerNanoAddress] = useState('')
  const [takenOffer, setTakenOffer] = useState<TakenOffer | null>(getStoredTakenOffer)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientSessionId] = useState(getClientSessionId)

  const loadOffers = async () => {
    setError(null)
    setLoading('offers')

    try {
      const response = await getOffers()
      setOffers(response.offers)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las ofertas.')
    } finally {
      setLoading(null)
    }
  }

  useEffect(() => {
    let ignore = false

    getOffers()
      .then((response) => {
        if (!ignore) setOffers(response.offers)
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las ofertas.')
        }
      })

    return () => {
      ignore = true
    }
  }, [])

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

  const updateSellerForm = (field: keyof typeof sellerForm, value: string) => {
    setSellerForm((current) => ({ ...current, [field]: value }))
  }

  const handleStartSellerPayment = async () => {
    setError(null)
    setPublishedOffer(null)
    setEscrowSession(null)
    setLoading('start-payment')

    try {
      const intent = await startSellerPayment(clientSessionId)
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
    setError(null)
    setLoading('take')

    try {
      const response = await takeOffer(selectedOffer.id, { buyerNanoAddress, clientSessionId })
      setTakenOffer(response)
      setSelectedOffer(null)
      setBuyerNanoAddress('')
      await loadOffers()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo tomar la oferta.')
    } finally {
      setLoading(null)
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
        <div>
          <h1>Nanopaquete</h1>
          <p className="topbar-subtitle">Custodia de Nano para comercio P2P</p>
        </div>
        <button className="ghost-button" type="button" onClick={loadOffers} disabled={loading === 'offers'}>
          <RefreshCw size={18} />
          Actualizar
        </button>
      </header>

      <section className="intro-band">
        <div>
          <p className="eyebrow">Compra y venta P2P</p>
          <h2>Transfiere XNO a custodia y publica la oferta desde el pago confirmado.</h2>
          <p>
            La cantidad en venta la define la transferencia Nano. Cuando el deposito se confirma, se habilita
            el formulario para divisa, precio y contacto privado del vendedor.
          </p>
        </div>
        <div className="flow-grid" aria-label="Flujo principal">
          <span><ShieldCheck size={18} /> Deposito</span>
          <ArrowRight size={18} />
          <span><CheckCircle2 size={18} /> Publicacion</span>
          <ArrowRight size={18} />
          <span>0.1 XNO comision</span>
        </div>
      </section>

      {error && <div className="status-message error">{error}</div>}

      <section className="work-grid">
        <div className="panel seller-panel">
          <div className="panel-heading">
            <p className="eyebrow">Vendedor</p>
            <h2>Crear oferta</h2>
          </div>

          {!sellerPayment && !escrowSession && (
            <div className="deposit-start">
              <p>
                Inicia el deposito y transfiere a la cuenta de custodia la cantidad exacta de XNO que quieres vender.
              </p>
              <button className="primary-button" type="button" onClick={handleStartSellerPayment} disabled={loading === 'start-payment'}>
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
                Contacto privado
                <input
                  placeholder="+57... WhatsApp o @usuario Telegram"
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
              <p className="eyebrow">Comprador</p>
              <h2>Ofertas disponibles</h2>
            </div>
            <span>{offers.length} activas</span>
          </div>

          <div className="offer-list">
            {offers.map((offer) => {
              const isSelected = selectedOffer?.id === offer.id

              return (
                <article className={isSelected ? 'offer-card selected-offer-card' : 'offer-card'} key={offer.id}>
                  <div>
                    <p className="offer-amount">{offer.amountXno} XNO</p>
                    <p>{offer.price} {offer.currency}</p>
                    <small>Publicada {shortDate(offer.createdAt)}</small>
                  </div>
                  {!isSelected && (
                    <button type="button" onClick={() => setSelectedOffer(offer)}>
                      Tomar oferta
                    </button>
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
                          value={buyerNanoAddress}
                          onChange={(event) => setBuyerNanoAddress(event.target.value)}
                          required
                          autoFocus
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
            {!offers.length && <p className="empty-state">No hay ofertas activas en este momento.</p>}
          </div>

          {takenOffer && (
            <div className="private-box buyer-result">
              <p className="eyebrow">Negociacion iniciada</p>
              <h3>Comunicate con el vendedor para acordar como haras el pago.</h3>
              <p>Los XNO de esta oferta ya estan bloqueados en custodia. El vendedor solo puede pedir que se liberen a la wallet Nano que registraste cuando reciba tu pago.</p>
              <dl>
                <dt>Contacto vendedor</dt>
                <dd>{takenOffer.sellerContact}</dd>
                <dt>Oferta tomada</dt>
                <dd>{takenOffer.offer.amountXno} XNO por {takenOffer.offer.price} {takenOffer.offer.currency}</dd>
              </dl>
              <button
                className="ghost-button danger-button"
                type="button"
                onClick={handleCancelTakenOffer}
                disabled={loading === 'cancel-take'}
              >
                Cancelar proceso
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
