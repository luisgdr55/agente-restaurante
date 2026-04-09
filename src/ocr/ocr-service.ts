/**
 * Servicio OCR para comprobantes de pago.
 *
 * Usa tesseract.js (modo node) para extraer texto de imágenes
 * y luego aplica regex para identificar campos clave del comprobante.
 *
 * Soporta múltiples formatos de bancos venezolanos (Banesco, BDV, Mercantil, etc.)
 *
 * El procesamiento es async / fuera del flujo principal del bot
 * para no bloquear la respuesta al cliente.
 */
import { createWorker } from 'tesseract.js';
import { logger } from '../utils/logger';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Datos estructurados extraídos de un comprobante de pago.
 * Todos los campos son opcionales porque no todos los bancos muestran lo mismo.
 */
export interface PaymentReceiptData {
  /** Últimos 4 dígitos del número de referencia/operación */
  referencia: string | null;
  /** Fecha y hora de la operación */
  fecha: string | null;
  /** Teléfono de destino (04XX-XXXXXXX) */
  telefonoDestino: string | null;
  /** RIF o CI del receptor (J-XXXXXXXX, V-XXXXXXXX) */
  receptor: string | null;
  /** Monto de la operación (ej. "Bs. 75,00") */
  monto: string | null;
}

export interface OcrResult {
  rawText: string;
  /** Número de referencia completo (para guardar en DB) */
  reference: string | null;
  /** Datos estructurados del comprobante para mostrar al admin */
  paymentData: PaymentReceiptData;
  confidence: number; // 0-100
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Extrae texto de un Buffer de imagen usando tesseract.js.
 * Soporta español + dígitos para maximizar precisión en comprobantes.
 */
export async function extractTextFromImage(imageBuffer: Buffer): Promise<OcrResult> {
  const worker = await createWorker('spa+eng', 1, {
    logger: () => undefined, // silenciar logs internos de tesseract
  });

  try {
    const { data } = await worker.recognize(imageBuffer);

    const rawText = data.text ?? '';
    const confidence = Math.round(data.confidence ?? 0);

    const reference = extractReference(rawText);
    const paymentData = extractPaymentData(rawText);

    logger.debug(
      { confidence, hasReference: !!reference, textLength: rawText.length },
      'OCR completed',
    );

    return { rawText, reference, paymentData, confidence };
  } finally {
    await worker.terminate();
  }
}

// ─── Extracción estructurada ──────────────────────────────────────────────────

/**
 * Extrae todos los campos clave de un comprobante de pago.
 * Soporta: Banesco, BDV (Banco de Venezuela), Mercantil, BNC, Bicentenario, etc.
 */
export function extractPaymentData(text: string): PaymentReceiptData {
  return {
    referencia: extractReferencia(text),
    fecha: extractFecha(text),
    telefonoDestino: extractTelefonoDestino(text),
    receptor: extractReceptor(text),
    monto: extractMonto(text),
  };
}

/**
 * Extrae los últimos 4 dígitos del número de referencia/operación.
 * El número completo se extrae primero y se trunca.
 */
function extractReferencia(text: string): string | null {
  const full = extractReference(text);
  if (!full) return null;
  return full.slice(-4);
}

/**
 * Extrae el número de referencia completo (8-25 dígitos).
 * Prioriza el número más largo encontrado.
 */
export function extractReference(text: string): string | null {
  // Normalizar: quitar separadores comunes entre dígitos
  const normalized = text.replace(/(\d)[\s\-.](\d)/g, '$1$2');

  // Buscar secuencias de 8-25 dígitos (cubre la mayoría de referencias venezolanas)
  const matches = normalized.match(/\b\d{8,25}\b/g);
  if (!matches || matches.length === 0) return null;

  // Preferir el número más largo (más probable que sea la referencia)
  matches.sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

/**
 * Extrae la fecha/hora de la operación.
 * Formatos soportados:
 *   - DD/MM/YYYY HH:MM AM/PM (Banesco, Mercantil)
 *   - YYYY-MM-DD HH:MM (otros)
 *   - DD-MM-YYYY (solo fecha)
 */
function extractFecha(text: string): string | null {
  // DD/MM/YYYY HH:MM AM/PM
  const m1 = text.match(
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i,
  );
  if (m1) return `${m1[1]} ${m1[2].toUpperCase()}`;

  // YYYY-MM-DD HH:MM
  const m2 = text.match(/\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(\d{1,2}:\d{2})/);
  if (m2) return `${m2[1]} ${m2[2]}`;

  // Solo fecha DD/MM/YYYY o YYYY/MM/DD
  const m3 = text.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/);
  return m3?.[0] ?? null;
}

/**
 * Extrae el teléfono de destino del comprobante.
 * Formatos venezolanos: 04XX-XXXXXXX, 04XXXXXXXXX, enmascarado 04**-***XXXX
 */
function extractTelefonoDestino(text: string): string | null {
  // Teléfono visible: 04XX-XXXXXXX o 04XXXXXXXXX
  const m = text.match(/\b0[24]\d{2}[-\s]?\d{3,7}[-\s]?\d{4}\b/);
  if (m) return m[0];

  // Teléfono enmascarado: 04**-***XXXX (Banesco lo muestra así)
  const masked = text.match(/0[24]\*+[-\s]?\*+\d{4}/);
  return masked?.[0] ?? null;
}

/**
 * Extrae el RIF o CI del receptor.
 * Formatos: J-XXXXXXXXX, V-XXXXXXXX, E-XXXXXXXX, G-XXXXXXXXX
 */
function extractReceptor(text: string): string | null {
  const m = text.match(/\b([JVEG][-\s]?\d{7,9})\b/i);
  if (!m) return null;
  return m[0].replace(/\s/g, '').toUpperCase();
}

/**
 * Extrae el monto de la operación.
 * Formatos: "Bs. 1.697,56", "Bs 75,00", "BsS 100.00", "1.697,56 Bs"
 */
function extractMonto(text: string): string | null {
  // "Bs. 1.697,56" / "Bs 75,00"
  const m1 = text.match(/Bs\.?\s*[\d.,]+/i);
  if (m1) return m1[0].replace(/\s+/g, ' ').trim();

  // "1.697,56 Bs" (monto antes de la unidad)
  const m2 = text.match(/[\d.,]+\s*Bs\.?/i);
  return m2?.[0]?.replace(/\s+/g, ' ').trim() ?? null;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Verifica si el texto OCR parece un comprobante de pago móvil venezolano.
 */
/**
 * Verifica si el texto OCR es un comprobante de pago móvil venezolano.
 *
 * Criterios (todos obligatorios salvo donde se indica):
 *   0. BLOQUEO: rechazar explícitamente crypto, USD, monedas extranjeras
 *   1. OBLIGATORIO: monto en bolívares (Bs.) con formato venezolano
 *   2. OBLIGATORIO: banco venezolano reconocido
 *   3. OBLIGATORIO: teléfono 04XX venezolano O RIF (J/V/E/G-)
 *
 * Bancos soportados: Banesco, Mercantil, BDV, BNC, Bicentenario, Provincial,
 *                    Exterior, Tesoro, Activo, Sofitasa, Tpago, Nacional Crédito.
 */
export function isPaymentReceipt(text: string): boolean {
  // 0. Bloqueo explícito — rechazar antes de cualquier otra validación
  const isCrypto =
    /\bUSDT\b|\bBTC\b|\bETH\b|\bBNB\b|\bXRP\b|\bUSDC\b|\bTRX\b/i.test(text) ||
    /TRC20|ERC20|BEP20|blockchain|wallet\s+address/i.test(text) ||
    /binance|coinbase|kraken|bybit|bitso|localbitcoin/i.test(text) ||
    /0x[0-9a-fA-F]{20,}/.test(text);    // dirección Ethereum/hex

  const isForeignCurrency =
    /\bUSD\b|\bEUR\b|\bARS\b|\bCOP\b|\bPEN\b|\bCLP\b|\bMXN\b/.test(text) ||
    /\$\s*[\d.,]+(?!\s*Bs)/i.test(text) ||   // "$7,472" sin "Bs" después
    /CUIT\b|CBU\b|CVU\b|Uniform\s+Bank\s+Key/i.test(text);  // Argentina

  if (isCrypto || isForeignCurrency) return false;

  // 1. Debe tener bolívares con formato venezolano (número seguido/precedido de Bs.)
  const hasBs =
    /\bBs\.?\s*[\d.,]+/i.test(text) ||   // "Bs. 1.697,56" / "Bs 75,00"
    /[\d.,]+\s*Bs\.?\b/i.test(text) ||   // "1.697,56 Bs"
    /\(Bs\.\)/i.test(text) ||             // "Monto (Bs.):" — formato Mercantil
    /bolivar/i.test(text);

  if (!hasBs) return false;

  // 2. Banco venezolano reconocido — OBLIGATORIO
  const hasVenezuelanBank =
    /banesco|mercantil|b\.?d\.?v\b|banco\s+de\s+venezuela|bicentenario|provincial|bnc\b|banco\s+nacional|exterior|tesoro\b|activo\b|sofitasa|fondo\s+com[uú]n|tpago|100\s*%\s*banco|venezolano\s+de\s+cr[eé]dito|ban[eé]xo/i.test(text);

  if (!hasVenezuelanBank) return false;

  // 3. Teléfono venezolano (04XX) O RIF — al menos uno obligatorio
  const hasVenezuelanPhone =
    /\b0[24]\d{2}[-\s]?\d{3,7}[-\s]?\d{4}\b/.test(text) ||
    /04\*+[-\s]?\*+\d{4}/.test(text);

  const hasRif = /\b[JVEGjveg][-\s]?\d{7,9}\b/.test(text);

  return hasVenezuelanPhone || hasRif;
}

/**
 * Formatea los datos del comprobante en texto legible para el admin.
 * Muestra "N/A" para campos no encontrados.
 */
export function formatPaymentDataForAdmin(data: PaymentReceiptData, source: 'image' | 'text'): string {
  const lines: string[] = [];

  if (source === 'image') {
    lines.push('📋 *Datos del comprobante (OCR):*');
  } else {
    lines.push('📋 *Referencia enviada por cliente:*');
  }

  lines.push(`🔢 Ref: ${data.referencia ? `****${data.referencia}` : '_(no detectada)_'}`);

  if (source === 'image') {
    lines.push(`📅 Fecha: ${data.fecha ?? '_(no detectada)_'}`);
    lines.push(`📱 Destino: ${data.telefonoDestino ?? '_(no detectado)_'}`);
    lines.push(`🪪 Receptor: ${data.receptor ?? '_(no detectado)_'}`);
    lines.push(`💵 Monto: ${data.monto ?? '_(no detectado)_'}`);
  }

  return lines.join('\n');
}
