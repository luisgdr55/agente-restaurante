import { useEffect, useState, useCallback } from 'react';
import { configApi, promoDayApi, driversApi } from '../api/api';
import type { ConfigEntry, DayPromo, Driver } from '../api/api';

interface EditingPromo {
  name: string;
  description: string;
  priceBs: string;
}

const EDITABLE_KEYS = [
  { key: 'USD_TO_BS_RATE',      label: 'Tasa USD → Bs',                        type: 'number' },
  { key: 'BUSINESS_ACTIVE',     label: 'Restaurante activo',                   type: 'toggle' },
  { key: 'DELIVERY_AVAILABLE',  label: 'Delivery disponible',                  type: 'toggle' },
  { key: 'DELIVERY_FEE_USD',    label: 'Precio delivery (USD)',                type: 'number' },
  { key: 'PAGO_MOVIL_BANK',     label: 'Banco pago móvil',                     type: 'text'   },
  { key: 'PAGO_MOVIL_PHONE',    label: 'Teléfono pago móvil',                  type: 'text'   },
  { key: 'PAGO_MOVIL_RIF',      label: 'RIF/CI pago móvil',                    type: 'text'   },
  { key: 'ADMIN_PHONE',         label: 'Teléfono admin (con código país sin +)', type: 'text' },
  { key: 'NOTIFICATION_PHONE',  label: 'Teléfono notificaciones de pedidos',   type: 'text'   },
  { key: 'BUSINESS_OPEN_TIME',  label: 'Abre a las',                           type: 'time'   },
  { key: 'BUSINESS_CLOSE_TIME', label: 'Cierra a las',                         type: 'time'   },
];

const DAYS = [
  { n: 1, label: 'Lun' },
  { n: 2, label: 'Mar' },
  { n: 3, label: 'Mié' },
  { n: 4, label: 'Jue' },
  { n: 5, label: 'Vie' },
  { n: 6, label: 'Sáb' },
  { n: 0, label: 'Dom' },
];

export default function SettingsPage() {
  const [config, setConfig]         = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState<string | null>(null);
  const [saved, setSaved]           = useState<string | null>(null);
  const [crisisSaving, setCrisisSaving] = useState<string | null>(null);

  // Motorizados
  const [drivers, setDrivers]         = useState<Driver[]>([]);
  const [driverName, setDriverName]   = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverSaving, setDriverSaving] = useState(false);
  const [driverError, setDriverError]   = useState('');
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [editName, setEditName]           = useState('');
  const [editPhone, setEditPhone]         = useState('');
  const [editSaving, setEditSaving]       = useState(false);
  const [removeMsg, setRemoveMsg]         = useState<{ id: string; text: string } | null>(null);

  // Promos del día
  const [promos, setPromos]           = useState<DayPromo[]>([]);
  const [promoDays, setPromoDays]     = useState<number[]>([]);
  const [daysSaving, setDaysSaving]   = useState(false);
  // Editing state: index → draft
  const [editing, setEditing]         = useState<Record<number, EditingPromo>>({});
  const [itemSaving, setItemSaving]   = useState<number | null>(null);
  // New promo form
  const [newName, setNewName]         = useState('');
  const [newDesc, setNewDesc]         = useState('');
  const [newPriceBs, setNewPriceBs]   = useState('');
  const [promoSaving, setPromoSaving] = useState(false);
  const [promoError, setPromoError]   = useState('');

  const loadDrivers = useCallback(() => {
    driversApi.getAll().then(setDrivers).catch(() => undefined);
  }, []);

  useEffect(() => {
    configApi.getAll().then((entries: ConfigEntry[]) => {
      const map: Record<string, string> = {};
      entries.forEach(e => { map[e.key] = e.value; });
      setConfig(map);
    }).catch(() => undefined);
    loadDrivers();
  }, [loadDrivers]);

  const handleAddDriver = async () => {
    if (!driverName.trim() || !driverPhone.trim()) return;
    setDriverSaving(true);
    setDriverError('');
    try {
      await driversApi.create({ name: driverName.trim(), phone: driverPhone.trim() });
      setDriverName('');
      setDriverPhone('');
      loadDrivers();
    } catch {
      setDriverError('Teléfono ya registrado o error al guardar.');
    } finally {
      setDriverSaving(false);
    }
  };

  const handleToggleDriver = async (driver: Driver) => {
    await driversApi.update(driver.id, { isActive: !driver.isActive }).catch(() => undefined);
    loadDrivers();
  };

  const handleEditDriver = (driver: Driver) => {
    setEditingDriver(driver);
    setEditName(driver.name);
    setEditPhone(driver.phone);
    setRemoveMsg(null);
  };

  const handleSaveDriver = async () => {
    if (!editingDriver) return;
    setEditSaving(true);
    await driversApi.update(editingDriver.id, { name: editName.trim(), phone: editPhone.trim() }).catch(() => undefined);
    setEditingDriver(null);
    loadDrivers();
    setEditSaving(false);
  };

  const handleRemoveDriver = async (driver: Driver) => {
    const result = await driversApi.remove(driver.id).catch(() => null);
    if (result?.softDeleted) {
      setRemoveMsg({ id: driver.id, text: 'Este motorizado tiene historial de pedidos. Se desactivó en lugar de eliminarse.' });
    } else {
      setRemoveMsg(null);
    }
    loadDrivers();
  };

  const loadPromoData = useCallback(() => {
    Promise.all([promoDayApi.getPromos(), promoDayApi.getDays()])
      .then(([p, d]) => { setPromos(p); setPromoDays(d.days); })
      .catch(() => undefined);
  }, []);

  useEffect(() => { loadPromoData(); }, [loadPromoData]);

  const handleSave = async (key: string, value: string) => {
    setSaving(key);
    try {
      await configApi.update(key, value);
      setConfig(prev => ({ ...prev, [key]: value }));
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  const handleToggle = async (key: string) => {
    const current = config[key] === 'true';
    await handleSave(key, String(!current));
  };

  const rate = parseFloat(config['USD_TO_BS_RATE'] ?? '0') || 0;

  const handleCrisisToggle = async (key: string) => {
    const current = config[key] === 'true';
    setCrisisSaving(key);
    try {
      await configApi.update(key, String(!current));
      setConfig(prev => ({ ...prev, [key]: String(!current) }));
    } finally {
      setCrisisSaving(null);
    }
  };

  const bsToUsd = (bs: string) => {
    const n = parseFloat(bs);
    if (!n || !rate) return '';
    return (n / rate).toFixed(2);
  };

  const startEditing = (i: number, p: DayPromo) => {
    setEditing(prev => ({ ...prev, [i]: { name: p.name, description: p.description ?? '', priceBs: p.priceBs > 0 ? String(p.priceBs) : '' } }));
  };

  const cancelEditing = (i: number) => {
    setEditing(prev => { const n = { ...prev }; delete n[i]; return n; });
  };

  const handleSavePromo = async (i: number) => {
    const draft = editing[i];
    if (!draft) return;
    setItemSaving(i);
    try {
      await promoDayApi.updatePromo(i, {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        priceBs: parseFloat(draft.priceBs) || 0,
      });
      loadPromoData();
      cancelEditing(i);
    } finally {
      setItemSaving(null);
    }
  };

  const handleAddPromo = async () => {
    if (!newName.trim()) return;
    setPromoSaving(true);
    setPromoError('');
    try {
      await promoDayApi.addPromo({ name: newName.trim(), description: newDesc.trim() || undefined, priceBs: parseFloat(newPriceBs) || 0 });
      setNewName(''); setNewDesc(''); setNewPriceBs('');
      loadPromoData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al agregar la promo';
      setPromoError(msg);
    } finally {
      setPromoSaving(false);
    }
  };

  const handleRemovePromo = async (index: number) => {
    await promoDayApi.removePromo(index);
    cancelEditing(index);
    loadPromoData();
  };

  const handleClearPromos = async () => {
    await promoDayApi.clearPromos();
    setEditing({});
    loadPromoData();
  };

  const handleToggleDay = async (day: number) => {
    const next = promoDays.includes(day)
      ? promoDays.filter(d => d !== day)
      : [...promoDays, day];
    setDaysSaving(true);
    try {
      await promoDayApi.setDays(next);
      setPromoDays(next);
    } finally {
      setDaysSaving(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>⚙️ Configuración</h2>

      {/* ── Control de Crisis ─────────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem', maxWidth: 600 }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '1rem', color: '#ef4444' }}>🚨 Control de Crisis</h3>

        {/* Alta demanda */}
        <div className="card" style={{ marginBottom: '0.75rem', borderLeft: config['IS_HIGH_DEMAND'] === 'true' ? '3px solid #f59e0b' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>⏳ Alta demanda</p>
              <p className="text-muted text-xs">Banner ámbar en la PWA — tiempos de espera aumentados</p>
            </div>
            <button
              className={`btn btn-sm ${config['IS_HIGH_DEMAND'] === 'true' ? 'btn-danger' : 'btn-success'}`}
              style={{ background: config['IS_HIGH_DEMAND'] === 'true' ? '#f59e0b' : undefined, minWidth: 90 }}
              disabled={crisisSaving === 'IS_HIGH_DEMAND'}
              onClick={() => void handleCrisisToggle('IS_HIGH_DEMAND')}
            >
              {crisisSaving === 'IS_HIGH_DEMAND' ? '...' : config['IS_HIGH_DEMAND'] === 'true' ? '✅ Activo' : '⬜ Inactivo'}
            </button>
          </div>
        </div>

        {/* Sin luz / Contingencia */}
        <div className="card" style={{ marginBottom: '0.75rem', borderLeft: config['IS_POWER_OUTAGE'] === 'true' ? '3px solid #ef4444' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>⚡ Sin luz / Contingencia</p>
              <p className="text-muted text-xs">Banner rojo en la PWA con mensaje personalizable</p>
            </div>
            <button
              className={`btn btn-sm ${config['IS_POWER_OUTAGE'] === 'true' ? 'btn-danger' : 'btn-success'}`}
              style={{ minWidth: 90 }}
              disabled={crisisSaving === 'IS_POWER_OUTAGE'}
              onClick={() => void handleCrisisToggle('IS_POWER_OUTAGE')}
            >
              {crisisSaving === 'IS_POWER_OUTAGE' ? '...' : config['IS_POWER_OUTAGE'] === 'true' ? '🔴 Activo' : '⬜ Inactivo'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              value={config['OUTAGE_MESSAGE'] ?? ''}
              onChange={e => setConfig(prev => ({ ...prev, OUTAGE_MESSAGE: e.target.value }))}
              placeholder="Mensaje para el cliente..."
              style={{ flex: 1, fontSize: '0.85rem' }}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={saving === 'OUTAGE_MESSAGE'}
              onClick={() => void handleSave('OUTAGE_MESSAGE', config['OUTAGE_MESSAGE'] ?? '')}
            >
              {saving === 'OUTAGE_MESSAGE' ? '...' : 'Guardar'}
            </button>
          </div>
        </div>

      </div>

      {/* ── Config general ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 600 }}>
        {EDITABLE_KEYS.map(({ key, label, type }) => (
          <div key={key} className="card">
            <label>{label}</label>
            <div className="flex gap-1 mt-1" style={{ alignItems: 'center' }}>
              {type === 'toggle' ? (
                <>
                  <button
                    className={`btn btn-sm ${config[key] === 'true' ? 'btn-success' : 'btn-danger'}`}
                    onClick={() => void handleToggle(key)}
                    disabled={saving === key}
                  >
                    {config[key] === 'true' ? '✅ Activo' : '🔴 Inactivo'}
                  </button>
                  {saved === key && <span className="text-success text-xs">✓ Guardado</span>}
                </>
              ) : (
                <>
                  <input
                    type={type}
                    step={type === 'number' ? '0.01' : undefined}
                    value={config[key] ?? ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleSave(key, config[key] ?? '')}
                    disabled={saving === key}
                  >
                    {saving === key ? '...' : 'Guardar'}
                  </button>
                  {saved === key && <span className="text-success text-xs">✓</span>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Promos del día ─────────────────────────────────────────────── */}
      <h2 style={{ margin: '2rem 0 1rem', fontSize: '1.25rem' }}>🔥 Promos del día</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 600 }}>

        {/* Días de promo */}
        <div className="card">
          <label style={{ marginBottom: '0.6rem', display: 'block' }}>
            Días en que aplica el modo promo
            {daysSaving && <span className="text-muted text-xs" style={{ marginLeft: 8 }}>Guardando...</span>}
          </label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {DAYS.map(({ n, label }) => {
              const active = promoDays.includes(n);
              return (
                <button
                  key={n}
                  className="btn btn-sm"
                  onClick={() => void handleToggleDay(n)}
                  style={{
                    background: active ? 'var(--accent)' : 'var(--surface2)',
                    color: active ? '#fff' : 'var(--text2)',
                    fontWeight: active ? 700 : 400,
                    minWidth: 44,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {promoDays.length === 0 && (
            <p className="text-muted text-xs mt-1">Sin días configurados — el modo promo no se activará automáticamente.</p>
          )}
        </div>

        {/* Lista de promos */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ margin: 0 }}>Promos activas hoy ({promos.length})</label>
            {promos.length > 0 && (
              <button className="btn btn-danger btn-sm" onClick={() => void handleClearPromos()}>
                🗑️ Limpiar todo
              </button>
            )}
          </div>

          {promos.length === 0 ? (
            <p className="text-muted text-xs">Sin promos registradas. Agrega una abajo.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
              {promos.map((p, i) => {
                const draft = editing[i];
                return (
                  <div key={i} style={{ padding: '0.75rem', background: 'var(--surface2)', borderRadius: 8, border: draft ? '1px solid var(--accent)' : '1px solid transparent' }}>
                    {draft ? (
                      /* ── Edit mode ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <input
                          type="text"
                          placeholder="Nombre de la promo *"
                          value={draft.name}
                          onChange={e => setEditing(prev => ({ ...prev, [i]: { ...prev[i]!, name: e.target.value } }))}
                          style={{ fontSize: '0.875rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Descripción (opcional)"
                          value={draft.description}
                          onChange={e => setEditing(prev => ({ ...prev, [i]: { ...prev[i]!, description: e.target.value } }))}
                          style={{ fontSize: '0.875rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <div style={{ position: 'relative', flex: 1 }}>
                            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text2)' }}>Bs</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={draft.priceBs}
                              onChange={e => setEditing(prev => ({ ...prev, [i]: { ...prev[i]!, priceBs: e.target.value } }))}
                              style={{ paddingLeft: 28, fontSize: '0.875rem' }}
                            />
                          </div>
                          {bsToUsd(draft.priceBs) && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>≈ ${bsToUsd(draft.priceBs)}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                          <button className="btn btn-sm" style={{ background: 'var(--surface3)', color: 'var(--text2)' }} onClick={() => cancelEditing(i)}>Cancelar</button>
                          <button className="btn btn-primary btn-sm" disabled={itemSaving === i || !draft.name.trim()} onClick={() => void handleSavePromo(i)}>
                            {itemSaving === i ? '...' : '💾 Guardar'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── View mode ── */
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 700, minWidth: 20, paddingTop: 2 }}>{i + 1}.</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{p.name}</div>
                          {p.description && <div style={{ fontSize: '0.75rem', color: 'var(--text2)', marginTop: 2 }}>{p.description}</div>}
                          {p.priceBs > 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: 4 }}>
                              Bs {p.priceBs.toFixed(2)}{rate > 0 ? ` · $${(p.priceBs / rate).toFixed(2)}` : ''}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button className="btn btn-sm" style={{ background: 'transparent', color: 'var(--accent)', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => startEditing(i, p)}>✏️</button>
                          <button className="btn btn-sm" style={{ background: 'transparent', color: 'var(--error)', padding: '0.2rem 0.4rem' }} onClick={() => void handleRemovePromo(i)}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Agregar promo */}
          <div style={{ borderTop: promos.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: promos.length > 0 ? '0.75rem' : 0 }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text2)', marginBottom: '0.5rem', fontWeight: 600 }}>+ Nueva promo</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <input
                type="text"
                placeholder="Nombre de la promo *"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleAddPromo(); }}
              />
              <input
                type="text"
                placeholder="Descripción (opcional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: 'var(--text2)' }}>Bs</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={newPriceBs}
                    onChange={e => setNewPriceBs(e.target.value)}
                    style={{ paddingLeft: 28 }}
                  />
                </div>
                {bsToUsd(newPriceBs) && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>≈ ${bsToUsd(newPriceBs)}</span>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleAddPromo()}
                  disabled={promoSaving || !newName.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {promoSaving ? '...' : '+ Agregar'}
                </button>
              </div>
              {promoError && (
                <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  ❌ {promoError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Motorizados ────────────────────────────────────────────────── */}
      <div style={{ marginTop: '2rem', maxWidth: 600 }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>🛵 Motorizados</h3>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

          {/* Lista */}
          {drivers.length === 0 ? (
            <div style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>
              No hay motorizados registrados todavía.
            </div>
          ) : (
            drivers.map((d) => (
              <div key={d.id}>
                {editingDriver?.id === d.id ? (
                  /* ── Modo edición inline ── */
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.4rem 0', borderBottom: '1px solid var(--surface2)', alignItems: 'center' }}>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ flex: '1 1 120px', padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
                    />
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      style={{ flex: '2 1 160px', padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid var(--surface2)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
                    />
                    <button className="btn btn-sm btn-primary" disabled={editSaving || !editName.trim() || !editPhone.trim()} onClick={() => void handleSaveDriver()} style={{ fontSize: '0.75rem' }}>
                      {editSaving ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingDriver(null)} style={{ fontSize: '0.75rem' }}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  /* ── Vista normal ── */
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--surface2)' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                      <span style={{ color: 'var(--text2)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{d.phone}</span>
                      {!d.isActive && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 4, padding: '1px 6px' }}>
                          inactivo
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleEditDriver(d)} style={{ fontSize: '0.75rem' }}>
                        Editar
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void handleToggleDriver(d)} style={{ fontSize: '0.75rem' }}>
                        {d.isActive ? 'Desactivar' : 'Activar'}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void handleRemoveDriver(d)} style={{ fontSize: '0.75rem', color: 'var(--error)' }}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}
                {removeMsg?.id === d.id && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text2)', padding: '0.25rem 0 0.4rem', fontStyle: 'italic' }}>
                    ℹ️ {removeMsg.text}
                  </div>
                )}
              </div>
            ))
          )}

          {/* Formulario agregar */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
            <input
              type="text"
              placeholder="Nombre"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              style={{ flex: '1 1 140px', padding: '0.3rem 0.5rem', borderRadius: '6px',
                border: '1px solid var(--surface2)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: '0.85rem' }}
            />
            <input
              type="text"
              placeholder="Teléfono (ej: 584121234567)"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              style={{ flex: '2 1 200px', padding: '0.3rem 0.5rem', borderRadius: '6px',
                border: '1px solid var(--surface2)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: '0.85rem' }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={driverSaving || !driverName.trim() || !driverPhone.trim()}
              onClick={() => void handleAddDriver()}
              style={{ whiteSpace: 'nowrap' }}
            >
              {driverSaving ? '...' : '+ Agregar'}
            </button>
          </div>
          {driverError && (
            <p style={{ color: 'var(--error)', fontSize: '0.75rem' }}>❌ {driverError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
