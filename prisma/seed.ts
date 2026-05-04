import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── System Config ─────────────────────────────────────────────────────────
  const configs = [
    { key: 'USD_TO_BS_RATE',      value: '36.50',           description: 'Tasa de cambio USD → Bs (actualizar diariamente)' },
    { key: 'PAGO_MOVIL_PHONE',    value: '04124659957',      description: 'Teléfono para pago móvil' },
    { key: 'PAGO_MOVIL_BANK',     value: 'Banco de Venezuela', description: 'Banco receptor' },
    { key: 'PAGO_MOVIL_HOLDER',   value: 'Yebraim',          description: 'Nombre del titular de la cuenta' },
    { key: 'PAGO_MOVIL_RIF',      value: 'V-26316385',       description: 'RIF/Cédula del titular' },
    { key: 'RESTAURANT_NAME',     value: "Yebram's Restaurant", description: 'Nombre del restaurante' },
    { key: 'RESTAURANT_HOURS',    value: 'Lun-Dom 11:00am - 10:00pm', description: 'Horario de atención' },
    { key: 'DELIVERY_FEE_USD',    value: '1.50',            description: 'Costo de delivery en USD' },
    { key: 'MIN_ORDER_USD',       value: '3.00',            description: 'Pedido mínimo en USD' },
    { key: 'ADMIN_PHONE',         value: '584124659957',    description: 'Número WhatsApp del admin (con código país sin +)' },
    { key: 'NOTIFICATION_PHONE',  value: '584124659957',    description: 'Número para notificaciones de pedidos' },
    { key: 'WELCOME_MESSAGE',     value: '¡Hola! 👋 Bienvenido a *{restaurant_name}*.\n\nAhora puedes hacer tu pedido directo por aquí, rápido y fácil 🍗🍔\n\n¿Con quién tengo el gusto?', description: 'Mensaje de bienvenida a nuevos clientes' },
    { key: 'BUSINESS_ACTIVE',     value: 'true',            description: 'Estado del bot (true/false)' },
    { key: 'DELIVERY_AVAILABLE',   value: 'true',            description: 'Servicio de delivery activo' },
    { key: 'DELIVERY_ETA_MINUTES', value: '20',              description: 'Tiempo estimado de entrega en minutos' },
    { key: 'SCHEDULE_ENABLED',    value: 'false',           description: 'Activa/desactiva el horario automático (true/false)' },
    { key: 'SCHEDULE_OPEN_TIME',  value: '10:00',           description: 'Hora de apertura automática en VEN (UTC-4), formato HH:MM' },
    { key: 'SCHEDULE_CLOSE_TIME', value: '22:00',           description: 'Hora de cierre automático en VEN (UTC-4), formato HH:MM' },
    { key: 'SCHEDULE_DAYS',       value: '[1,2,3,4,5,6]',  description: 'Días activos (JSON): 0=Dom, 1=Lun … 6=Sáb' },
    // ── Crisis control ──────────────────────────────────────────────────────
    { key: 'IS_HIGH_DEMAND',      value: 'false', description: 'Control de crisis: alta demanda activa (true/false)' },
    { key: 'IS_POWER_OUTAGE',     value: 'false', description: 'Control de crisis: contingencia eléctrica activa (true/false)' },
    { key: 'OUTAGE_MESSAGE',      value: 'Estamos con fallas eléctricas, procesando pedidos con cautela 🕯️', description: 'Mensaje personalizable para contingencia eléctrica' },
    { key: 'IS_ORDERS_PAUSED',    value: 'false', description: 'Control de crisis: pedidos pausados (true/false)' },
    { key: 'ORDERS_PAUSE_MINUTES', value: '15',  description: 'Minutos de pausa al activar PAUSA_PEDIDOS' },
    { key: 'ORDERS_PAUSE_UNTIL',  value: '',      description: 'Timestamp ISO de reapertura (vacío si inactivo)' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where:  { key: config.key },
      update: ['RESTAURANT_NAME', 'WELCOME_MESSAGE'].includes(config.key) ? { value: config.value } : {},
      create: config,
    });
  }

  console.log(`✅ ${configs.length} config entries seeded`);

  // ── Limpiar menú anterior ─────────────────────────────────────────────────
  await prisma.promotion.deleteMany({});
  await prisma.review.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.menuItem.deleteMany({});
  await prisma.menuCategory.deleteMany({});
  console.log('🧹 Previous menu cleared');

  // ── Categorías ────────────────────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.menuCategory.create({ data: { id: 'cat-broaster',     name: 'Pollo a la Broaster', emoji: '🍗', sortOrder: 1 } }),
    prisma.menuCategory.create({ data: { id: 'cat-snacks',       name: 'Snacks de Pollo',     emoji: '🍿', sortOrder: 2 } }),
    prisma.menuCategory.create({ data: { id: 'cat-clubhouse',    name: 'Club House',          emoji: '🥡', sortOrder: 3 } }),
    prisma.menuCategory.create({ data: { id: 'cat-burgers',      name: 'Hamburguesas',        emoji: '🍔', sortOrder: 4 } }),
    prisma.menuCategory.create({ data: { id: 'cat-lomito',       name: 'Parrillas de Lomito', emoji: '🥩', sortOrder: 5 } }),
    prisma.menuCategory.create({ data: { id: 'cat-recientes',    name: 'Platos Recientes',    emoji: '🍽️', sortOrder: 6 } }),
    prisma.menuCategory.create({ data: { id: 'cat-combos',       name: 'Combos',              emoji: '🎁', sortOrder: 7 } }),
    prisma.menuCategory.create({ data: { id: 'cat-panas',        name: "Pa' los Panas",       emoji: '🎉', sortOrder: 8 } }),
    prisma.menuCategory.create({ data: { id: 'cat-complementos', name: 'Complementos',        emoji: '🍟', sortOrder: 9 } }),
    prisma.menuCategory.create({ data: { id: 'cat-postres',      name: 'Postres',             emoji: '🍮', sortOrder: 10 } }),
  ]);

  console.log(`✅ ${categories.length} categories seeded`);

  // ── Items ─────────────────────────────────────────────────────────────────
  const items = [
    // ── Pollo a la Broaster ──────────────────────────────────────────────────
    { id: 'broaster-kids', categoryId: 'cat-broaster', name: 'Kids (1 Pieza)',      description: 'Papas Fritas + 1 Porción de Ensalada + 1 Queso Broaster + Bebida',                                    priceUsd: '3.99',  sortOrder: 1 },
    { id: 'broaster-2',    categoryId: 'cat-broaster', name: '2 Piezas',            description: 'Papas Fritas + 2 Porciones de Ensalada + 2 Quesos Broaster + Refresco 355ml',                         priceUsd: '6.99',  sortOrder: 2 },
    { id: 'broaster-3',    categoryId: 'cat-broaster', name: '3 Piezas',            description: 'Papas Fritas + 2 Porciones de Ensalada + 2 Quesos Broaster + Refresco 355ml',                         priceUsd: '7.99',  sortOrder: 3 },
    { id: 'broaster-4',    categoryId: 'cat-broaster', name: '4 Piezas',            description: 'Papas Fritas + 4 Porciones de Ensalada + 4 Quesos Broaster + Refresco 1L',                            priceUsd: '13.49', sortOrder: 4 },
    { id: 'broaster-6',    categoryId: 'cat-broaster', name: '6 Piezas',            description: 'Papas Fritas + 4 Porciones de Ensalada + 4 Quesos Broaster + Refresco 1L',                            priceUsd: '15.49', sortOrder: 5 },
    { id: 'broaster-8',    categoryId: 'cat-broaster', name: '8 Piezas',            description: 'Papas Fritas + 8 Porciones de Ensalada + 8 Quesos Broaster + Refresco 1.5L',                         priceUsd: '22.49', sortOrder: 6 },
    { id: 'broaster-10',   categoryId: 'cat-broaster', name: '10 Piezas (1 Pollo)', description: 'Papas Fritas + 10 Porciones de Ensalada + 10 Quesos Broaster + Refresco 1.5L',                       priceUsd: '26.99', sortOrder: 7 },
    { id: 'broaster-12',   categoryId: 'cat-broaster', name: '12 Piezas',           description: 'Papas Fritas + 10 Porciones de Ensalada + 10 Quesos Broaster + Refresco 2L',                         priceUsd: '30.99', sortOrder: 8 },

    // ── Snacks de Pollo ──────────────────────────────────────────────────────
    { id: 'snack-popcorn',         categoryId: 'cat-snacks', name: 'Pop Corns',        description: '200g Pop Corn + Papas Fritas + Bebida',                         priceUsd: '5.99', sortOrder: 1 },
    { id: 'snack-tenders',         categoryId: 'cat-snacks', name: 'Tenders',          description: '8 Tenders + Papas Fritas + Bebida',                            priceUsd: '6.99', sortOrder: 2 },
    { id: 'snack-alitas-clasicas', categoryId: 'cat-snacks', name: 'Alitas Clásicas',  description: '4 Alitas + 4 Chupetas de Pollo + Papas Fritas + Bebida',       priceUsd: '6.99', sortOrder: 3 },
    { id: 'snack-alitas-bbq',      categoryId: 'cat-snacks', name: 'Alitas BBQ',       description: '4 Alitas + 4 Chupetas de Pollo + Papas Fritas + Bebida',       priceUsd: '6.99', sortOrder: 4 },
    { id: 'snack-alitas-picantes', categoryId: 'cat-snacks', name: 'Alitas Picantes',  description: '4 Alitas + 4 Chupetas de Pollo + Papas Fritas + Bebida',       priceUsd: '6.99', sortOrder: 5 },

    // ── Club House ───────────────────────────────────────────────────────────
    { id: 'ch-esp-pollo',  categoryId: 'cat-clubhouse', name: 'CH Esp. Pollo (4 Pzas)',  description: 'Club House Especial de Pollo Crispy, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',       priceUsd: '8.99',  sortOrder: 1 },
    { id: 'ch-esp-carne',  categoryId: 'cat-clubhouse', name: 'CH Esp. Carne (4 Pzas)',  description: 'Club House Especial de Carne, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',              priceUsd: '8.99',  sortOrder: 2 },
    { id: 'ch-esp-mixto',  categoryId: 'cat-clubhouse', name: 'CH Esp. Mixto (4 Pzas)',  description: 'Club House Especial Mixto (Pollo y Carne), Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas', priceUsd: '10.99', sortOrder: 3 },
    { id: 'ch-sup-pollo',  categoryId: 'cat-clubhouse', name: 'CH Super Pollo (8 Pzas)', description: 'Club House Super de Pollo Crispy, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',          priceUsd: '16.99', sortOrder: 4 },
    { id: 'ch-sup-carne',  categoryId: 'cat-clubhouse', name: 'CH Super Carne (8 Pzas)', description: 'Club House Super de Carne, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',                priceUsd: '16.99', sortOrder: 5 },
    { id: 'ch-sup-mixto',  categoryId: 'cat-clubhouse', name: 'CH Super Mixto (8 Pzas)', description: 'Club House Super Mixto (Pollo y Carne), Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',   priceUsd: '20.99', sortOrder: 6 },
    { id: 'ch-mega-pollo', categoryId: 'cat-clubhouse', name: 'CH Mega Pollo (12 Pzas)', description: 'Club House Mega de Pollo Crispy, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',           priceUsd: '25.99', sortOrder: 7 },
    { id: 'ch-mega-carne', categoryId: 'cat-clubhouse', name: 'CH Mega Carne (12 Pzas)', description: 'Club House Mega de Carne, Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',                 priceUsd: '25.99', sortOrder: 8 },
    { id: 'ch-mega-mixto', categoryId: 'cat-clubhouse', name: 'CH Mega Mixto (12 Pzas)', description: 'Club House Mega Mixto (Pollo y Carne), Queso Gouda, Tocineta Crocante, Huevo, Tomate, Lechuga, Papas Fritas, Salsas',    priceUsd: '31.99', sortOrder: 9 },

    // ── Hamburguesas ─────────────────────────────────────────────────────────
    { id: 'burg-pana-sola',     categoryId: 'cat-burgers', name: 'Pana (Sola)',                       description: 'Pan Brioche, Medallón de Pollo Frito, Lechuga, Salsa de la casa',                                                                           priceUsd: '3.99',  sortOrder: 1 },
    { id: 'burg-pana-combo',    categoryId: 'cat-burgers', name: 'Pana + Papas y Refresco',           description: 'Pan Brioche, Medallón de Pollo Frito, Lechuga, Salsa de la casa + Papas Fritas y Refresco',                                                 priceUsd: '5.99',  sortOrder: 2 },
    { id: 'burg-clasica-sola',  categoryId: 'cat-burgers', name: 'Clásica (Sola)',                    description: 'Pan Brioche, Carne o Pollo Crispy, Queso Gouda, Tomate, Lechuga, Salsa de la casa',                                                          priceUsd: '5.49',  sortOrder: 3 },
    { id: 'burg-clasica-combo', categoryId: 'cat-burgers', name: 'Clásica+Papas y Refresco',         description: 'Pan Brioche, Carne o Pollo Crispy, Queso Gouda, Tomate, Lechuga, Salsa de la casa + Papas Fritas y Refresco',                                priceUsd: '7.49',  sortOrder: 4 },
    { id: 'burg-crispy-sola',   categoryId: 'cat-burgers', name: 'Crispy Cesar (Sola)',               description: 'Pan Brioche, Pollo Crispy, Ensalada Cesar',                                                                                                  priceUsd: '5.99',  sortOrder: 5 },
    { id: 'burg-crispy-combo',  categoryId: 'cat-burgers', name: 'Crispy Cesar+Papas',               description: 'Pan Brioche, Pollo Crispy, Ensalada Cesar + Papas Fritas y Refresco',                                                                        priceUsd: '7.99',  sortOrder: 6 },
    { id: 'burg-yebrams-sola',  categoryId: 'cat-burgers', name: "Yebram's (Sola)",                   description: "Pan Brioche, Pollo Crispy, Queso Gouda, Queso Crema, Tocineta Crocante, Huevo, Lechuga, Cebolla, Salsa Yebram's",                            priceUsd: '6.99',  sortOrder: 7 },
    { id: 'burg-yebrams-combo', categoryId: 'cat-burgers', name: "Yebram's+Papas Refresco",           description: "Pan Brioche, Pollo Crispy, Queso Gouda, Queso Crema, Tocineta Crocante, Huevo, Lechuga, Cebolla, Salsa Yebram's + Papas Fritas y Refresco", priceUsd: '8.99',  sortOrder: 8 },
    { id: 'burg-picon-sola',    categoryId: 'cat-burgers', name: 'Picón Green (Sola)',                description: 'Pan Brioche, Carne o Pollo Crispy, Pepinillos, Salsa de Pepinillos, Queso Gouda, Tocineta Crocante, Tomate, Cebolla, Lechuga',               priceUsd: '6.99',  sortOrder: 9 },
    { id: 'burg-picon-combo',   categoryId: 'cat-burgers', name: 'Picón Green+Papas',                description: 'Pan Brioche, Carne o Pollo Crispy, Pepinillos, Salsa de Pepinillos, Queso Gouda, Tocineta Crocante, Tomate, Cebolla, Lechuga + Papas y Refresco', priceUsd: '8.99', sortOrder: 10 },
    { id: 'burg-caramel-sola',  categoryId: 'cat-burgers', name: 'Caramelizada (Sola)',               description: 'Pan Brioche, Carne o Pollo Crispy, Cebolla Caramelizada, Queso Gouda, Queso Crema, Tocineta Crocante, Tomate, Lechuga, Salsa',               priceUsd: '6.99',  sortOrder: 11 },
    { id: 'burg-caramel-combo', categoryId: 'cat-burgers', name: 'Caramelizada+Papas',               description: 'Pan Brioche, Carne o Pollo Crispy, Cebolla Caramelizada, Queso Gouda, Queso Crema, Tocineta Crocante, Tomate, Lechuga, Salsa + Papas y Refresco', priceUsd: '8.99', sortOrder: 12 },
    { id: 'burg-smash-sola',    categoryId: 'cat-burgers', name: 'Triple Smash (Sola)',               description: 'Pan Brioche, 210gr de Triple Carne Smash, Triple Queso Gouda, Tocineta Crocante, Salsa BBQ, Salsa de Queso Cheddar',                          priceUsd: '6.99',  sortOrder: 13 },
    { id: 'burg-smash-combo',   categoryId: 'cat-burgers', name: 'Triple Smash+Papas',               description: 'Pan Brioche, 210gr de Triple Carne Smash, Triple Queso Gouda, Tocineta Crocante, Salsa BBQ, Salsa de Queso Cheddar + Papas y Refresco',      priceUsd: '8.99',  sortOrder: 14 },
    { id: 'burg-mega-sola',     categoryId: 'cat-burgers', name: "Mega Yebram's (Sola)",              description: 'Pan Brioche, Doble Pollo Crispy, Doble Queso Gouda, Doble Tocineta, Doble Huevo, Queso Crema, Cebolla, Lechuga, Salsa Yebram',               priceUsd: '8.99',  sortOrder: 15 },
    { id: 'burg-mega-combo',    categoryId: 'cat-burgers', name: "Mega Yebram's+Papas",              description: 'Pan Brioche, Doble Pollo Crispy, Doble Queso Gouda, Doble Tocineta, Doble Huevo, Queso Crema, Cebolla, Lechuga, Salsa Yebram + Papas y Refresco', priceUsd: '10.99', sortOrder: 16 },

    // ── Parrillas de Lomito ──────────────────────────────────────────────────
    { id: 'lomito-personal-carne', categoryId: 'cat-lomito', name: 'Personal Carne',   description: 'Parrilla de Lomito con Chorizo, Papas Fritas, Ensalada y Quesos Broaster',                  priceUsd: '7.99',  sortOrder: 1 },
    { id: 'lomito-personal-mixta', categoryId: 'cat-lomito', name: 'Personal Mixta',   description: 'Parrilla de Lomito Mixta con Chorizo, Papas Fritas, Ensalada y Quesos Broaster',             priceUsd: '9.99',  sortOrder: 2 },
    { id: 'lomito-mixta-doble',    categoryId: 'cat-lomito', name: 'Mixta Doble',      description: 'Parrilla de Lomito Mixta Doble con Chorizo, Papas Fritas, Ensalada y Quesos Broaster',       priceUsd: '15.99', sortOrder: 3 },
    { id: 'lomito-mixta-familiar', categoryId: 'cat-lomito', name: 'Mixta Familiar',   description: 'Parrilla de Lomito Mixta Familiar con Chorizo, Papas Fritas, Ensalada y Quesos Broaster',    priceUsd: '24.99', sortOrder: 4 },
    { id: 'lomito-extra-familiar', categoryId: 'cat-lomito', name: 'Extra Familiar',   description: 'Parrilla de Lomito Extra Familiar con Chorizo, Papas Fritas, Ensalada y Quesos Broaster',    priceUsd: '31.99', sortOrder: 5 },

    // ── Platos Recientes ─────────────────────────────────────────────────────
    { id: 'rec-milan-plancha', categoryId: 'cat-recientes', name: 'Milanesa Plancha',      description: 'Milanesa de Pollo a la Plancha. Con Ensalada (Mixta, Rallada, Cocida o Cesar), Papas Fritas o Pan Al Ajillo y Quesos Broaster', priceUsd: '7.49', sortOrder: 1 },
    { id: 'rec-milan-empan',   categoryId: 'cat-recientes', name: 'Milanesa Empanizada',   description: 'Milanesa de Pollo Empanizada. Con Ensalada (Mixta, Rallada, Cocida o Cesar), Papas Fritas o Pan Al Ajillo y Quesos Broaster',   priceUsd: '7.99', sortOrder: 2 },
    { id: 'rec-medallones',    categoryId: 'cat-recientes', name: 'Medallones de Lomito',           description: 'Con Ensalada (Mixta, Rallada, Cocida o Cesar), Papas Fritas o Pan Al Ajillo y Quesos Broaster', priceUsd: '8.99', sortOrder: 3 },

    // ── Combos ───────────────────────────────────────────────────────────────
    { id: 'combo-vipbox',   categoryId: 'cat-combos', name: 'VIP Box',         description: '1 Hamb. Pana, Papas Fritas, 4 Tenders, 2 Tequeños, Bebida y Salsas',                                            priceUsd: '7.99',  sortOrder: 1 },
    { id: 'combo-trio',     categoryId: 'cat-combos', name: 'Trio de Alitas',  description: '6 Alitas Clásicas, 6 Alitas BBQ, 6 Alitas Picantes, Papas Fritas, 1L Refresco y Salsas',                        priceUsd: '16.99', sortOrder: 2 },
    { id: 'combo-super',    categoryId: 'cat-combos', name: 'Super Crujiente', description: "1 Hamb. Yebram's, 1 Pieza de Pollo, 4 Tenders, 3 Tequeños, Papas Fritas, 1L Refresco y Salsas",               priceUsd: '14.99', sortOrder: 3 },
    { id: 'combo-familiar', categoryId: 'cat-combos', name: 'Familiar',        description: '4 Piezas de Pollo + contornos, 1 Hamb. Clásica, 1 Ración de Alitas, 10 Tequeños y 1 Refresco 1.5L',            priceUsd: '29.99', sortOrder: 4 },

    // ── Pa' los Panas ────────────────────────────────────────────────────────
    { id: 'panas-6',  categoryId: 'cat-panas', name: "Pa' los Panas 6 Piezas",  description: '6 Piezas de Pollo Broaster con Papas Fritas, Refresco y Salsas',  priceUsd: '12.99', sortOrder: 1 },
    { id: 'panas-10', categoryId: 'cat-panas', name: "Pa' los Panas 10 Piezas", description: '10 Piezas de Pollo Broaster con Papas Fritas, Refresco y Salsas', priceUsd: '23.99', sortOrder: 2 },
    { id: 'panas-14', categoryId: 'cat-panas', name: "Pa' los Panas 14 Piezas", description: '14 Piezas de Pollo Broaster con Papas Fritas, Refresco y Salsas', priceUsd: '29.99', sortOrder: 3 },

    // ── Complementos ─────────────────────────────────────────────────────────
    { id: 'comp-papas',       categoryId: 'cat-complementos', name: 'Papas Fritas',            description: 'Porción de Papas Fritas crujientes',     priceUsd: '2.99', sortOrder: 1 },
    { id: 'comp-quesos',      categoryId: 'cat-complementos', name: 'Quesos Broaster (10)',    description: '10 unidades de Quesos Broaster',          priceUsd: '2.99', sortOrder: 2 },
    { id: 'comp-tequenos',    categoryId: 'cat-complementos', name: 'Tequeños (10)',           description: '10 unidades de Tequeños',                 priceUsd: '3.99', sortOrder: 3 },
    { id: 'comp-ensalada',    categoryId: 'cat-complementos', name: 'Ensalada Rallada',        description: 'Ensalada Rallada fresca',                 priceUsd: '2.99', sortOrder: 4 },
    { id: 'comp-cesar',       categoryId: 'cat-complementos', name: 'Ensalada Cesar',          description: 'Ensalada Cesar clásica',                  priceUsd: '3.99', sortOrder: 5 },
    { id: 'comp-cesar-pollo', categoryId: 'cat-complementos', name: 'Cesar con Pollo Crispy',  description: 'Ensalada Cesar con Pollo Crispy',         priceUsd: '5.99', sortOrder: 6 },

    // ── Postres ──────────────────────────────────────────────────────────────
    { id: 'postre-tresleches',      categoryId: 'cat-postres', name: 'Tres Leches',              description: 'Delicioso pastel de Tres Leches',     priceUsd: '3.20', sortOrder: 1 },
    { id: 'postre-tresleches-choc', categoryId: 'cat-postres', name: 'Tres Leches de Chocolate', description: 'Pastel de Tres Leches con Chocolate', priceUsd: '3.20', sortOrder: 2 },
    { id: 'postre-quesillo',        categoryId: 'cat-postres', name: 'Quesillo',                 description: 'Quesillo venezolano casero',           priceUsd: '3.20', sortOrder: 3 },
  ];

  for (const item of items) {
    await prisma.menuItem.create({
      data: item as Parameters<typeof prisma.menuItem.create>[0]['data'],
    });
  }

  console.log(`✅ ${items.length} menu items seeded`);
  console.log("\n🎉 Yebram's Restaurant — seed completo!");
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
