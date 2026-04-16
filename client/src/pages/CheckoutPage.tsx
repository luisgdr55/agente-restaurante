import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { publicApi, type PublicConfig } from '../api/api'
import type { CartItem } from '../store/cart'
import Layout from '../components/Layout'

// Normalize Venezuelan phone to international format for the API lookup
function normalizePhoneForLookup(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('04') && digits.length === 11) return '58' + digits.slice(1)
  if (digits.startsWith('584') && digits.length === 12) return digits
  return digits
}

function usdToBs(usd: number, rate: number) {
  return (usd * rate).toFixed(2)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function CheckoutPage() {
  const navigate = useNavigate()

  // Load cart + config from sessionStorage
  const [cart] = useState<CartItem[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('yebrams_checkout_cart') ?? '[]') }
    catch { return [] }
  })
  const [config] = useState<PublicConfig | null>(() => {
    try { return JSON.parse(sessionStorage.getItem('yebrams_checkout_config') ?? 'null') }
    catch { return null }
  })

  const rate = parseFloat(config?.USD_TO_BS_RATE ?? '36.50')
  const deliveryFeeUsd = parseFloat(config?.DELIVERY_FEE_USD ?? '1.50')

  // Form state — pre-filled from localStorage if returning customer
  const [name, setName] = useState(() => localStorage.getItem('yebrams_customer_name') ?? '')
  const [phone, setPhone] = useState(() => localStorage.getItem('yebrams_customer_phone') ?? '')
  const [deliveryType, setDeliveryType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [address, setAddress] = useState(() => localStorage.getItem('yebrams_customer_address') ?? '')
  const [savedAddr, setSavedAddr] = useState<string | null>(null)
  const [useSaved, setUseSaved] = useState(false)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Redirect if cart empty
  useEffect(() => {
    if (cart.length === 0) navigate('/', { replace: true })
  }, [cart, navigate])

  // Fetch saved address when phone is filled (debounced 600ms)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      setSavedAddr(null)
      setUseSaved(false)
      return
    }
    const timer = setTimeout(() => {
      const normalized = normalizePhoneForLookup(phone)
      publicApi.getSavedAddress(normalized)
        .then((addr) => {
          setSavedAddr(addr)
          if (addr && !address) {
            setAddress(addr)
            setUseSaved(true)
          }
        })
        .catch(() => { /* non-critical */ })
    }, 600)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone])

  const subtotal = cart.reduce((s, i) => s + i.priceUsd * i.quantity, 0)
  const fee = deliveryType === 'DELIVERY' ? deliveryFeeUsd : 0
  const total = subtotal + fee

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    const preview = URL.createObjectURL(file)
    setProofPreview(preview)
  }

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) { setError('Ingresa tu nombre'); return }
    if (!phone.trim()) { setError('Ingresa tu teléfono'); return }
    if (deliveryType === 'DELIVERY' && !address.trim()) { setError('Ingresa tu dirección'); return }

    setSubmitting(true)
    try {
      let proofImageBase64: string | undefined
      if (proofFile) {
        proofImageBase64 = await fileToBase64(proofFile)
      }

      const result = await publicApi.createOrder({
        customerName: name.trim(),
        phone: phone.trim(),
        deliveryType,
        ...(deliveryType === 'DELIVERY' && address.trim() ? { address: address.trim() } : {}),
        items: cart.map((i) => ({ menuItemId: i.id, quantity: i.quantity })),
        ...(proofImageBase64 ? { proofImageBase64 } : {}),
      })

      // Clear cart
      sessionStorage.removeItem('yebrams_checkout_cart')
      sessionStorage.removeItem('yebrams_checkout_config')
      localStorage.removeItem('yebrams_cart')

      // Persist customer data for next order
      localStorage.setItem('yebrams_last_phone', phone.trim())
      localStorage.setItem('yebrams_customer_name', name.trim())
      localStorage.setItem('yebrams_customer_phone', phone.trim())
      if (deliveryType === 'DELIVERY' && address.trim()) {
        localStorage.setItem('yebrams_customer_address', address.trim())
      }

      navigate('/confirm', {
        state: {
          orderNumber: result.orderNumber,
          orderId: result.orderId,
          adminPhone: config?.ADMIN_PHONE ?? '',
          customerName: name.trim(),
          phone: phone.trim(),
          total,
          rate,
          deliveryType,
          address: deliveryType === 'DELIVERY' ? address.trim() : undefined,
          cart: cart.map((i) => ({ name: i.name, quantity: i.quantity, priceUsd: i.priceUsd })),
          pagoMovilBank: config?.PAGO_MOVIL_BANK ?? '',
          pagoMovilPhone: config?.PAGO_MOVIL_PHONE ?? '',
          pagoMovilHolder: config?.PAGO_MOVIL_HOLDER ?? '',
          pagoMovilRif: config?.PAGO_MOVIL_RIF ?? '',
          vapidPublicKey: config?.vapidPublicKey ?? '',
        },
      })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status: number; data: unknown }; message?: string }
      if (axiosErr.response) {
        console.error('[checkout] HTTP error', axiosErr.response.status, JSON.stringify(axiosErr.response.data))
      } else {
        console.error('[checkout] Network/unknown error', axiosErr.message, err)
      }
      setError('Error al procesar el pedido. Intenta de nuevo.')
      setSubmitting(false)
    }
  }

  if (cart.length === 0) return null

  return (
    <Layout>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1.25rem 1rem 5rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
        >
          ← Volver al menú
        </button>

        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '1.5rem' }}>Confirmar pedido</h1>

        {/* ── Resumen ── */}
        <section style={{ background: 'var(--surface)', borderRadius: 12, padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tu pedido</h2>
          {cart.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              <span>{item.quantity}× {item.name}</span>
              <span style={{ color: 'var(--accent)' }}>${(item.priceUsd * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #333', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
            {deliveryType === 'DELIVERY' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                <span>Delivery</span>
                <span>${fee.toFixed(2)} | Bs {usdToBs(fee, rate)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Total</span>
              <span style={{ color: 'var(--accent)' }}>${total.toFixed(2)} | Bs {usdToBs(total, rate)}</span>
            </div>
          </div>
        </section>

        {/* ── Tipo de entrega ── */}
        <section style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.6rem' }}>Tipo de entrega</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['DELIVERY', 'PICKUP'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setDeliveryType(type)}
                style={{
                  flex: 1, padding: '0.65rem',
                  borderRadius: 10,
                  fontWeight: 600, fontSize: '0.9rem',
                  background: deliveryType === type ? 'var(--accent)' : 'var(--surface)',
                  color: deliveryType === type ? '#000' : 'var(--text-muted)',
                  border: '2px solid',
                  borderColor: deliveryType === type ? 'var(--accent)' : 'transparent',
                }}
              >
                {type === 'DELIVERY' ? '🛵 Delivery' : '🏪 Retirar en local'}
              </button>
            ))}
          </div>
        </section>

        {/* ── Datos personales ── */}
        <section style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre completo" />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>Teléfono *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="04XX-XXX-XXXX"
            />
          </div>
          {deliveryType === 'DELIVERY' && (
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>Dirección de entrega *</label>

              {/* Saved address card */}
              {savedAddr && (
                <div style={{
                  background: 'rgba(245,197,24,0.06)',
                  border: '1px solid rgba(245,197,24,0.2)',
                  borderRadius: 10, padding: '0.75rem 1rem',
                  marginBottom: '0.6rem',
                }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    📍 Dirección anterior
                  </p>
                  <p style={{ fontSize: '0.88rem', color: 'var(--text)', marginBottom: '0.6rem', lineHeight: 1.4 }}>
                    {savedAddr}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => { setAddress(savedAddr); setUseSaved(true) }}
                      style={{
                        flex: 1, padding: '0.4rem 0',
                        borderRadius: 8, fontWeight: 700, fontSize: '0.8rem',
                        background: useSaved ? 'var(--accent)' : 'rgba(245,197,24,0.12)',
                        color: useSaved ? '#000' : 'var(--accent)',
                        border: useSaved ? 'none' : '1px solid rgba(245,197,24,0.3)',
                      }}
                    >
                      {useSaved ? '✓ Usando esta' : 'Usar esta'}
                    </button>
                    <button
                      onClick={() => { setAddress(''); setUseSaved(false) }}
                      style={{
                        flex: 1, padding: '0.4rem 0',
                        borderRadius: 8, fontWeight: 600, fontSize: '0.8rem',
                        background: !useSaved ? 'rgba(255,255,255,0.08)' : 'transparent',
                        color: !useSaved ? 'var(--text)' : 'var(--text-muted)',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      Ingresar otra
                    </button>
                  </div>
                </div>
              )}

              {/* Manual address textarea — shown when no savedAddr or user chose "Ingresar otra" */}
              {(!savedAddr || !useSaved) && (
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Calle, sector, referencia..."
                  rows={3}
                  style={{
                    width: '100%', background: 'var(--surface)',
                    border: '1px solid #3A3A3A', borderRadius: 8,
                    padding: '0.6rem 0.85rem', color: 'var(--text)',
                    fontSize: '1rem', resize: 'vertical', outline: 'none',
                  }}
                />
              )}
            </div>
          )}
        </section>

        {/* ── Datos pago móvil ── */}
        {config && (
          <section style={{ background: 'var(--surface)', borderRadius: 12, padding: '1rem', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📱 Datos de pago móvil
            </h2>
            {[
              ['Banco', config.PAGO_MOVIL_BANK],
              ['Teléfono', config.PAGO_MOVIL_PHONE],
              ['Titular', config.PAGO_MOVIL_HOLDER],
              ['RIF / Cédula', config.PAGO_MOVIL_RIF],
              ['Monto', `Bs ${usdToBs(total, rate)}`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.45rem', fontSize: '0.9rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontWeight: label === 'Monto' ? 700 : 400, color: label === 'Monto' ? 'var(--accent)' : 'var(--text)' }}>
                  {value}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* ── Upload comprobante ── */}
        <section style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem' }}>
            Comprobante de pago <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span>
          </label>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Sube la captura de tu pago para confirmar más rápido
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {proofPreview ? (
            <div style={{ position: 'relative' }}>
              <img
                src={proofPreview}
                alt="Comprobante"
                style={{ width: '100%', borderRadius: 10, maxHeight: 220, objectFit: 'cover' }}
              />
              <button
                onClick={() => { setProofFile(null); setProofPreview(null) }}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.7)', color: '#fff',
                  borderRadius: '50%', width: 28, height: 28,
                  fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '0.85rem',
                background: 'var(--surface)', border: '2px dashed #3A3A3A',
                borderRadius: 10, color: 'var(--text-muted)',
                fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              }}
            >
              📷 Subir foto del comprobante
            </button>
          )}
        </section>

        {error && (
          <p style={{ color: 'var(--error)', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>{error}</p>
        )}

        {/* ── Botón confirmar ── */}
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          style={{
            width: '100%', padding: '1rem',
            background: submitting ? '#555' : 'var(--accent)',
            color: '#000', borderRadius: 12,
            fontWeight: 700, fontSize: '1.05rem',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Procesando...' : `Confirmar pedido — $${total.toFixed(2)}`}
        </button>
      </div>
    </Layout>
  )
}
