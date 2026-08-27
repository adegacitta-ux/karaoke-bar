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

// --- SOMENTE SANDBOX: cartão de teste, nunca usado em produção -------------------
//
// O sandbox do Mercado Pago não tem "pagador de teste" para PIX — dá pra gerar o QR
// code, mas não existe forma de completar o pagamento de verdade e disparar o webhook
// de aprovação. Cartão de teste é o mecanismo oficial deles pra validar o resto do
// fluxo (webhook -> assinatura -> idempotência -> reordenação da fila) ponta a ponta.
// Doc: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/testing
//
// Dados de cartão de teste publicados oficialmente pelo Mercado Pago (não são dados
// reais de ninguém - são fixtures de teste, seguros para viver no código-fonte).
// O nome do titular controla o resultado simulado:
//   APRO = aprovado | OTHE = recusado (genérico) | CONT = pendente
//   CALL = recusado (autorização) | FUND = recusado (saldo) | SECU = recusado (CVV)
const CARTAO_TESTE = {
  card_number: "5031433215406351", // Mastercard de teste
  security_code: "123",
  expiration_month: 11,
  expiration_year: 2030,
};
const CPF_TESTE = "19119119100";

async function tokenizarCartaoTeste({ accessToken, cardholderName }) {
  const resp = await fetch(`${MP_API_BASE}/v1/card_tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      ...CARTAO_TESTE,
      cardholder: {
        name: cardholderName,
        identification: { type: "CPF", number: CPF_TESTE },
      },
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    const erro = new Error(`Falha ao tokenizar cartão de teste (status ${resp.status})`);
    erro.detalhes = data;
    throw erro;
  }
  return data.id;
}

/**
 * SOMENTE quando TEST_PAYMENT_METHOD=card está configurado no Worker (ver
 * wrangler.toml e docs/TESTES.md) — nunca chamado no caminho normal de produção, que
 * continua 100% PIX via criarCobrancaPix().
 *
 * @param {string} params.cardholderName - controla o resultado simulado (ver acima).
 *   Default "APRO" (aprovação automática, sem ação manual) — é o que testa o fluxo
 *   completo de webhook + reordenação da fila.
 */
export async function criarCobrancaCartaoTeste({
  accessToken,
  valorCentavos,
  descricao,
  barId,
  pedidoId,
  cardholderName = "APRO",
}) {
  const cardToken = await tokenizarCartaoTeste({ accessToken, cardholderName });

  const body = {
    transaction_amount: Math.round(valorCentavos) / 100,
    description: descricao,
    payment_method_id: "master",
    token: cardToken,
    installments: 1,
    payer: {
      email: "comprador-teste@cantoke.dev",
      identification: { type: "CPF", number: CPF_TESTE },
    },
    metadata: { bar_id: barId, pedido_id: pedidoId },
    external_reference: `${barId}:${pedidoId}`,
  };

  const resp = await fetch(`${MP_API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) {
    const erro = new Error(`Mercado Pago recusou a cobrança de teste com cartão (status ${resp.status})`);
    erro.detalhes = data;
    erro.status = resp.status;
    throw erro;
  }

  return { paymentId: data.id, status: data.status, qrCode: null, qrCodeBase64: null };
}
// -----------------------------------------------------------------------------------

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
