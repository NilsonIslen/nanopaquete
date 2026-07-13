import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
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
  const [takenOffer, setTakenOffer] = useState<TakenOffer | null>(null)
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
      const response = await takeOffer(selectedOffer.id, { buyerNanoAddress })
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

  const copyValue = async (value: string) => {
    await navigator.clipboard.writeText(value)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Custodia manual para XNO</p>
          <h1>Nanopaquete</h1>
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
            </div>
          )}

          {escrowSession && (
            <div className="private-box verified-box">
              <p className="eyebrow">Deposito confirmado</p>
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
            {offers.map((offer) => (
              <article className="offer-card" key={offer.id}>
                <div>
                  <p className="offer-amount">{offer.amountXno} XNO</p>
                  <p>{offer.price} {offer.currency}</p>
                  <small>Publicada {shortDate(offer.createdAt)}</small>
                </div>
                <button type="button" onClick={() => setSelectedOffer(offer)}>
                  Tomar oferta
                </button>
              </article>
            ))}
            {!offers.length && <p className="empty-state">No hay ofertas activas en este momento.</p>}
          </div>

          {selectedOffer && (
            <form className="take-form" onSubmit={handleTakeOffer}>
              <div>
                <p className="eyebrow">Tomar oferta</p>
                <h3>{selectedOffer.amountXno} XNO por {selectedOffer.price} {selectedOffer.currency}</h3>
              </div>
              <label>
                Wallet nano donde recibiras los XNO
                <input
                  placeholder="nano_..."
                  value={buyerNanoAddress}
                  onChange={(event) => setBuyerNanoAddress(event.target.value)}
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

          {takenOffer && (
            <div className="private-box buyer-result">
              <p className="eyebrow">Negociacion iniciada</p>
              <dl>
                <dt>Contacto vendedor</dt>
                <dd>{takenOffer.sellerContact}</dd>
                <dt>Codigo temporal</dt>
                <dd>{takenOffer.buyerCancelCode}</dd>
                <dt>Contacto custodio</dt>
                <dd>{takenOffer.custodianContact}</dd>
                <dt>Comision custodio</dt>
                <dd>{takenOffer.custodyFeeXno} XNO</dd>
              </dl>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
