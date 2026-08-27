// Validação da assinatura de webhooks do Mercado Pago.
// Doc: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks#Como-verificar-uma-assinatura-de-webhook

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparação em tempo constante (defesa em profundidade contra timing attack).
function compararConstante(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseXSignature(header) {
  // Formato: "ts=1704908010,v1=<hash>"
  const partes = {};
  for (const par of header.split(",")) {
    const [chave, valor] = par.split("=");
    if (chave && valor) partes[chave.trim()] = valor.trim();
  }
  return partes;
}

/**
 * Valida o header x-signature de uma notificação do Mercado Pago.
 * @param {object} params
 * @param {string} params.xSignature - header x-signature recebido
 * @param {string} params.xRequestId - header x-request-id recebido
 * @param {string} params.dataId - o data.id (payment id) vindo da query string/body
 * @param {string} params.secret - segredo da assinatura do webhook (configurado no app do MP)
 * @returns {Promise<boolean>}
 */
export async function validarAssinaturaWebhook({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !xRequestId || !dataId || !secret) return false;

  const { ts, v1 } = parseXSignature(xSignature);
  if (!ts || !v1) return false;

  // data.id deve ser usado em minúsculas quando alfanumérico (recomendação oficial do MP).
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const assinaturaCalculada = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hashCalculadoHex = bytesToHex(new Uint8Array(assinaturaCalculada));

  return compararConstante(hashCalculadoHex, v1.toLowerCase());
}

export { hexToBytes, bytesToHex, compararConstante };
