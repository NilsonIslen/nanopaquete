import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  getOffers,
  publishOffer,
  registerEscrow,
  takeOffer,
  type Currency,
  type EscrowSession,
  type PublicOffer,
  type PublishedOffer,
  type TakenOffer,
} from './api'
import './Nanopaquete.css'

const currencies: Currency[] = ['COP', 'USD', 'BTC', 'EUR']

const initialSellerForm = {
  amountXno: '',
  sellerWallet: '',
  transferReference: '',
  currency: 'COP' as Currency,
  price: '',
  sellerContact: '',
}

const shortDate = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export function Nanopaquete() {
  const [sellerForm, setSellerForm] = useState(initialSellerForm)
  const [escrowSession, setEscrowSession] = useState<EscrowSession | null>(null)
  const [publishedOffer, setPublishedOffer] = useState<PublishedOffer | null>(null)
  const [offers, setOffers] = useState<PublicOffer[]>([])
  const [selectedOffer, setSelectedOffer] = useState<PublicOffer | null>(null)
  const [buyerNanoAddress, setBuyerNanoAddress] = useState('')
  const [takenOffer, setTakenOffer] = useState<TakenOffer | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const amountPreview = useMemo(() => {
    if (!sellerForm.amountXno) return 'Cantidad pendiente'
    return `${sellerForm.amountXno.replace(',', '.')} XNO`
  }, [sellerForm.amountXno])

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

  const updateSellerForm = (field: keyof typeof sellerForm, value: string) => {
    setSellerForm((current) => ({ ...current, [field]: value }))
  }

  const handleEscrowSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPublishedOffer(null)
    setLoading('escrow')

    try {
      const session = await registerEscrow({
        amountXno: sellerForm.amountXno,
        sellerWallet: sellerForm.sellerWallet || undefined,
        transferReference: sellerForm.transferReference || undefined,
      })
      setEscrowSession(session)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo registrar la custodia.')
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
          <h2>Publica XNO custodiado y negocia el pago directamente.</h2>
          <p>
            El vendedor deposita los XNO en custodia, publica una oferta privada de contacto y el comprador
            registra la wallet donde recibira los fondos si la operacion se completa.
          </p>
        </div>
        <div className="flow-grid" aria-label="Flujo principal">
          <span><ShieldCheck size={18} /> Custodia</span>
          <ArrowRight size={18} />
          <span><CheckCircle2 size={18} /> Negociacion</span>
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

          <form className="stack-form" onSubmit={handleEscrowSubmit}>
            <label>
              Cantidad de XNO en venta
              <input
                inputMode="decimal"
                placeholder="10"
                value={sellerForm.amountXno}
                onChange={(event) => updateSellerForm('amountXno', event.target.value)}
                required
              />
            </label>
            <label>
              Wallet nano del vendedor
              <input
                placeholder="nano_..."
                value={sellerForm.sellerWallet}
                onChange={(event) => updateSellerForm('sellerWallet', event.target.value)}
              />
            </label>
            <label>
              Referencia de transferencia
              <input
                placeholder="Hash, nota o confirmacion"
                value={sellerForm.transferReference}
                onChange={(event) => updateSellerForm('transferReference', event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit" disabled={loading === 'escrow'}>
              Registrar custodia
            </button>
          </form>

          {escrowSession && (
            <div className="private-box">
              <p className="eyebrow">Datos privados de custodia</p>
              <div className="copy-row">
                <span>{escrowSession.escrowWallet}</span>
                <button type="button" onClick={() => void copyValue(escrowSession.escrowWallet)} aria-label="Copiar wallet de custodia">
                  <Copy size={16} />
                </button>
              </div>
              <dl>
                <dt>Contacto custodio</dt>
                <dd>{escrowSession.custodianContact}</dd>
                <dt>Comision de liberacion</dt>
                <dd>{escrowSession.custodyFeeXno} XNO</dd>
                <dt>Monto asociado</dt>
                <dd>{amountPreview}</dd>
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
