// Chamadas à API do Mercado Pago (sandbox). Usa fetch nativo do Worker.

const MP_API_BASE = "https://api.mercadopago.com";

/**
 * Cria uma cobrança PIX dinâmica.
 * @param {object} params
 * @param {string} params.accessToken - MP_ACCESS_TOKEN (TEST-...)
 * @param {number} params.valorCentavos - valor em centavos (evita erro de ponto flutuante)
 * @param {string} params.descricao
 * @param {string} params.payerEmail - e-mail do comprador de teste do MP
 * @param {string} params.barId
 * @param {number} params.pedidoId - id do pedido na fila (Date.now()+random, ver fila-v2-sandbox)
 */
export async function criarCobrancaPix({ accessToken, valorCentavos, descricao, payerEmail, barId, pedidoId }) {
  const body = {
    transaction_amount: Math.round(valorCentavos) / 100,
    description: descricao,
    payment_method_id: "pix",
    payer: { email: payerEmail },
    metadata: { bar_id: barId, pedido_id: pedidoId },
    external_reference: `${barId}:${pedidoId}`,
  };

  const resp = await fetch(`${MP_API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // Evita criar cobranças duplicadas em caso de retry de rede do cliente.
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok) {
    const erro = new Error(`Mercado Pago recusou a criação da cobrança (status ${resp.status})`);
    erro.detalhes = data;
    erro.status = resp.status;
    throw erro;
  }

  const transactionData = data.point_of_interaction?.transaction_data ?? {};

  return {
    paymentId: data.id,
    status: data.status,
    qrCode: transactionData.qr_code ?? null, // copia e cola
    qrCodeBase64: transactionData.qr_code_base64 ?? null, // imagem PNG em base64
    ticketUrl: transactionData.ticket_url ?? null,
  };
}

/**
 * Consulta o estado real de um pagamento na API do MP.
 * NUNCA confiar no status vindo do payload do webhook — sempre reconsultar aqui.
 */
export async function consultarPagamento({ accessToken, paymentId }) {
  const resp = await fetch(`${MP_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const erro = new Error(`Falha ao consultar pagamento ${paymentId} (status ${resp.status})`);
    erro.status = resp.status;
    throw erro;
  }

  return resp.json();
}
