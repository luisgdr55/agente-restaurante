import { useEffect, useState, useRef } from 'react';
import { menuApi, type MenuCategoryFull, type MenuItem } from '../api/api';

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: 480, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
      >
        <div className="flex justify-between items-center">
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Category modal ───────────────────────────────────────────────────────────

const COMMON_EMOJIS = ['🍔', '🍕', '🌮', '🍣', '🍜', '🥗', '🍗', '🥩', '🌭', '🍟',
  '🥤', '🧃', '☕', '🍺', '🍰', '🧁', '🍦', '🍩', '🥐', '🫕'];

function CategoryModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: MenuCategoryFull;
  onSave: (data: { name: string; emoji: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '🍽️');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), emoji }); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={initial ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label>Nombre</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
            placeholder="Ej: Hamburguesas"
          />
        </div>

        <div>
          <label>Emoji</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            {COMMON_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                style={{
                  fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer',
                  borderRadius: 6, padding: '2px 4px',
                  outline: emoji === e ? '2px solid var(--accent)' : 'none',
                  opacity: emoji === e ? 1 : 0.6,
                }}
              >
                {e}
              </button>
            ))}
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              style={{ width: 60, textAlign: 'center', fontSize: '1.25rem' }}
              maxLength={2}
              placeholder="🍽️"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-1">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary btn-sm" disabled={saving || !name.trim()} onClick={() => void handleSubmit()}>
          {saving ? 'Guardando...' : (initial ? 'Guardar cambios' : 'Crear categoría')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Item modal ───────────────────────────────────────────────────────────────

function ItemModal({
  categoryId,
  categories,
  initial,
  onSave,
  onClose,
}: {
  categoryId: string;
  categories: MenuCategoryFull[];
  initial?: MenuItem;
  onSave: (data: { name: string; description: string; priceUsd: number; isAvailable: boolean; imageUrl: string | null }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial ? Number(initial.priceUsd).toFixed(2) : '');
  const [available, setAvailable] = useState(initial?.isAvailable ?? true);
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const catName = categories.find((c) => c.id === categoryId)?.name ?? '';

  const handleSubmit = async () => {
    const priceNum = parseFloat(price);
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (isNaN(priceNum) || priceNum <= 0) { setError('Ingresa un precio válido mayor a 0.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), description: description.trim(), priceUsd: priceNum, isAvailable: available, imageUrl: imageUrl.trim() || null });
      onClose();
    } catch {
      setError('Error al guardar. Intenta de nuevo.');
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? 'Editar producto' : `Nuevo producto en ${catName}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div>
          <label>Nombre del producto *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Big Burger"
          />
        </div>

        <div>
          <label>Descripción (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Ingredientes o descripción breve..."
            style={{ background: 'var(--surface2)', border: '1px solid #2a2a4a', borderRadius: 8, color: 'var(--text)', padding: '0.5rem 0.75rem', fontSize: '0.875rem', width: '100%', resize: 'vertical' }}
          />
        </div>

        <div>
          <label>Precio (USD) *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div>
          <label>URL de imagen (opcional)</label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://ejemplo.com/imagen.jpg"
          />
          {imageUrl.trim() && (
            <img
              src={imageUrl.trim()}
              alt="preview"
              style={{ marginTop: '0.5rem', maxHeight: 80, borderRadius: 6, objectFit: 'cover' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <label style={{ margin: 0 }}>Disponible ahora</label>
          <button
            className={`btn btn-sm ${available ? 'btn-success' : 'btn-danger'}`}
            onClick={() => setAvailable(!available)}
            style={{ marginLeft: 'auto' }}
          >
            {available ? '✅ Activo' : '🔴 Inactivo'}
          </button>
        </div>

        {error && <p style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{error}</p>}
      </div>

      <div className="flex gap-1">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSubmit()}>
          {saving ? 'Guardando...' : (initial ? 'Guardar cambios' : 'Agregar producto')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <Modal title="⚠️ Confirmar" onClose={onClose}>
      <p style={{ color: 'var(--text2)' }}>{message}</p>
      <div className="flex gap-1">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
        <button className="btn btn-danger btn-sm" disabled={loading} onClick={async () => { setLoading(true); await onConfirm(); onClose(); }}>
          {loading ? '...' : 'Eliminar'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
  toggling,
}: {
  item: MenuItem;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  toggling: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 0.75rem', borderRadius: 8,
        background: item.isAvailable ? 'rgba(76,175,80,0.05)' : 'rgba(244,67,54,0.05)',
        border: `1px solid ${item.isAvailable ? 'rgba(76,175,80,0.2)' : 'rgba(244,67,54,0.15)'}`,
        transition: 'all 0.2s',
      }}
    >
      {/* Toggle disponibilidad */}
      <button
        onClick={onToggle}
        disabled={toggling}
        title={item.isAvailable ? 'Clic para desactivar' : 'Clic para activar'}
        style={{
          fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer',
          opacity: toggling ? 0.5 : 1, flexShrink: 0,
        }}
      >
        {item.isAvailable ? '🟢' : '🔴'}
      </button>

      {/* Nombre + descripción */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: item.isAvailable ? 'var(--text)' : 'var(--text2)' }}>
          {item.name}
        </div>
        {item.description && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text2)', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {item.description}
          </div>
        )}
      </div>

      {/* Precio */}
      <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '0.9rem', flexShrink: 0 }}>
        ${Number(item.priceUsd).toFixed(2)}
      </div>

      {/* Acciones */}
      <button onClick={onEdit} title="Editar" className="btn btn-ghost btn-sm" style={{ flexShrink: 0, padding: '0.25rem 0.5rem' }}>✏️</button>
      <button onClick={onDelete} title="Eliminar" className="btn btn-ghost btn-sm" style={{ flexShrink: 0, padding: '0.25rem 0.5rem', color: 'var(--error)' }}>🗑️</button>
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({
  category,
  onEditCategory,
  onDeleteCategory,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onToggleItem,
  togglingIds,
}: {
  category: MenuCategoryFull;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  onAddItem: () => void;
  onEditItem: (item: MenuItem) => void;
  onDeleteItem: (item: MenuItem) => void;
  onToggleItem: (item: MenuItem) => void;
  togglingIds: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = category.items.filter((i) => i.isAvailable).length;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Category header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0.875rem 1rem', background: 'var(--surface2)',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: '1.4rem' }}>{category.emoji}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{category.name}</span>
          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text2)' }}>
            {activeCount}/{category.items.length} disponibles
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onEditCategory(); }}
          className="btn btn-ghost btn-sm"
          title="Editar categoría"
          style={{ padding: '0.25rem 0.5rem' }}
        >
          ✏️
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteCategory(); }}
          className="btn btn-ghost btn-sm"
          title="Eliminar categoría"
          style={{ padding: '0.25rem 0.5rem', color: 'var(--error)' }}
        >
          🗑️
        </button>
        <span style={{ color: 'var(--text2)', fontSize: '0.8rem' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {/* Items list */}
      {!collapsed && (
        <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {category.items.length === 0 ? (
            <p style={{ color: 'var(--text2)', fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem' }}>
              Esta categoría no tiene productos aún.
            </p>
          ) : (
            category.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                toggling={togglingIds.has(item.id)}
                onToggle={() => onToggleItem(item)}
                onEdit={() => onEditItem(item)}
                onDelete={() => onDeleteItem(item)}
              />
            ))
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onAddItem(); }}
            className="btn btn-ghost btn-sm"
            style={{ marginTop: '0.25rem', borderStyle: 'dashed', width: '100%' }}
          >
            + Agregar producto
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'new-category' }
  | { type: 'edit-category'; category: MenuCategoryFull }
  | { type: 'delete-category'; category: MenuCategoryFull }
  | { type: 'new-item'; categoryId: string }
  | { type: 'edit-item'; item: MenuItem }
  | { type: 'delete-item'; item: MenuItem };

export default function MenuPage() {
  const [menu, setMenu] = useState<MenuCategoryFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const menuRef = useRef(menu);
  menuRef.current = menu;

  const load = async () => {
    setLoading(true);
    try { setMenu(await menuApi.getFull()); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  // Optimistic toggle + server sync
  const handleToggleItem = async (item: MenuItem) => {
    setTogglingIds((s) => new Set(s).add(item.id));
    setMenu((prev) => prev.map((cat) => ({
      ...cat,
      items: cat.items.map((i) => i.id === item.id ? { ...i, isAvailable: !i.isAvailable } : i),
    })));
    try {
      await menuApi.updateItem(item.id, { isAvailable: !item.isAvailable });
    } catch {
      // Revert on error
      setMenu((prev) => prev.map((cat) => ({
        ...cat,
        items: cat.items.map((i) => i.id === item.id ? { ...i, isAvailable: item.isAvailable } : i),
      })));
    }
    setTogglingIds((s) => { const n = new Set(s); n.delete(item.id); return n; });
  };

  // Category CRUD
  const handleSaveCategory = async (data: { name: string; emoji: string }) => {
    if (modal.type === 'edit-category') {
      await menuApi.updateCategory(modal.category.id, data);
    } else {
      await menuApi.createCategory(data);
    }
    await load();
  };

  const handleDeleteCategory = async (id: string) => {
    await menuApi.deleteCategory(id);
    await load();
  };

  // Item CRUD
  const handleSaveItem = async (data: { name: string; description: string; priceUsd: number; isAvailable: boolean; imageUrl: string | null }) => {
    if (modal.type === 'edit-item') {
      await menuApi.updateItem(modal.item.id, data);
    } else if (modal.type === 'new-item') {
      await menuApi.createItem({ ...data, categoryId: modal.categoryId, imageUrl: data.imageUrl || undefined });
    }
    await load();
  };

  const handleDeleteItem = async (id: string) => {
    await menuApi.deleteItem(id);
    await load();
  };

  const totalItems = menu.reduce((s, c) => s + c.items.length, 0);
  const activeItems = menu.reduce((s, c) => s + c.items.filter((i) => i.isAvailable).length, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem' }}>🍽️ Menú</h2>
          {!loading && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: 2 }}>
              {menu.length} categorías · {activeItems}/{totalItems} productos disponibles
            </p>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'new-category' })}>
          + Nueva categoría
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text2)' }}>
          Cargando menú...
        </div>
      ) : menu.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ fontSize: '3rem' }}>🍽️</p>
          <p style={{ marginTop: '0.75rem', color: 'var(--text2)' }}>El menú está vacío.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginTop: '0.5rem' }}>
            Empieza creando una categoría (ej: Hamburguesas, Bebidas).
          </p>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: '1.25rem' }}
            onClick={() => setModal({ type: 'new-category' })}
          >
            + Crear primera categoría
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {menu.map((cat) => (
            <CategorySection
              key={cat.id}
              category={cat}
              togglingIds={togglingIds}
              onEditCategory={() => setModal({ type: 'edit-category', category: cat })}
              onDeleteCategory={() => setModal({ type: 'delete-category', category: cat })}
              onAddItem={() => setModal({ type: 'new-item', categoryId: cat.id })}
              onEditItem={(item) => setModal({ type: 'edit-item', item })}
              onDeleteItem={(item) => setModal({ type: 'delete-item', item })}
              onToggleItem={handleToggleItem}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {(modal.type === 'new-category' || modal.type === 'edit-category') && (
        <CategoryModal
          initial={modal.type === 'edit-category' ? modal.category : undefined}
          onSave={handleSaveCategory}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'delete-category' && (
        <ConfirmModal
          message={`¿Eliminar la categoría "${modal.category.name}" y todos sus productos? Esta acción no se puede deshacer.`}
          onConfirm={() => handleDeleteCategory(modal.category.id)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {(modal.type === 'new-item' || modal.type === 'edit-item') && (
        <ItemModal
          categoryId={modal.type === 'new-item' ? modal.categoryId : modal.item.categoryId}
          categories={menu}
          initial={modal.type === 'edit-item' ? modal.item : undefined}
          onSave={handleSaveItem}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'delete-item' && (
        <ConfirmModal
          message={`¿Eliminar el producto "${modal.item.name}"?`}
          onConfirm={() => handleDeleteItem(modal.item.id)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}
    </div>
  );
}
