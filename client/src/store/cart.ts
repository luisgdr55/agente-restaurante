import { useState, useEffect, useCallback } from 'react'

export interface CartItem {
  id: string
  name: string
  priceUsd: number
  quantity: number
  imageUrl: string | null
}

const STORAGE_KEY = 'yebrams_cart'

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CartItem[]) : []
  } catch {
    return []
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>(loadCart)

  useEffect(() => {
    saveCart(items)
  }, [items])

  const add = useCallback((item: Omit<CartItem, 'quantity'>) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id)
      if (existing) {
        return prev.map((i) => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { ...item, quantity: 1 }]
    })
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === id)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter((i) => i.id !== id)
      return prev.map((i) => i.id === id ? { ...i, quantity: i.quantity - 1 } : i)
    })
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const total = items.reduce((sum, i) => sum + i.priceUsd * i.quantity, 0)
  const count = items.reduce((sum, i) => sum + i.quantity, 0)

  return { items, add, remove, clear, total, count }
}
