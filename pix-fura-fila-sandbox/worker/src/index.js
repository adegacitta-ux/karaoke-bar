import { criarCobrancaPix, consultarPagamento } from "./mercadopago.js";
import { validarAssinaturaWebhook } from "./validarAssinatura.js";
import { barExiste, pagamentoJaProcessado, pedidoExisteNaFila, furarFila } from "./firebase.js";
import { permitido } from "./rateLimit.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // sandbox: restrinja ao domínio do front-end em produção
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleCriarCobranca(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "desconhecido";
  if (!(await permitido(env, ip))) {
    return json({ erro: "Muitas requisições. Tente novamente em instantes." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  const { barId, pedidoId } = body ?? {};
  if (!barId || !Number.isFinite(pedidoId)) {
    return json({ erro: "barId e pedidoId (número) são obrigatórios" }, 400);
  }

  // O valor é definido pelo servidor (env var), nunca confiado do cliente — evita que
  // alguém manipule o body da requisição para pagar centavos por um "fura-fila".
  const valorCentavos = parseInt(env.PRECO_FURAR_FILA_CENTAVOS ?? "1000", 10);

  if (!(await barExiste(env.FIREBASE_DATABASE_URL, barId, env.FIREBASE_SERVICE_ACCOUNT_JSON))) {
    return json({ erro: "Bar não encontrado" }, 404);
  }

  if (!(await pedidoExisteNaFila(env.FIREBASE_DATABASE_URL, barId, pedidoId, env.FIREBASE_SERVICE_ACCOUNT_JSON))) {
    return json({ erro: "Pedido não encontrado na fila" }, 404);
  }

  try {
    const cobranca = await criarCobrancaPix({
      accessToken: env.MP_ACCESS_TOKEN,
      valorCentavos,
      descricao: `Fura-fila karaokê — pedido ${pedidoId}`,
      payerEmail: body.payerEmail ?? "comprador-teste@cantoke.dev",
      barId,
      pedidoId,
    });

    return json({
      paymentId: cobranca.paymentId,
      status: cobranca.status,
      qrCode: cobranca.qrCode,
      qrCodeBase64: cobranca.qrCodeBase64,
    });
  } catch (erro) {
    console.error("Erro ao criar cobrança PIX", erro, erro.detalhes);
    return json({ erro: "Falha ao criar cobrança PIX" }, 502);
  }
}

async function handleWebhookPix(request, env) {
  const url = new URL(request.url);

  // MP notifica tanto via query string (?type=payment&data.id=123) quanto via body.
  let body = {};
  try {
    body = await request.json();
  } catch {
    // body pode vir vazio em alguns formatos de notificação — segue com a query string.
  }

  const tipo = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body?.type;
  const dataId = url.searchParams.get("data.id") ?? body?.data?.id;

  if (tipo !== "payment" || !dataId) {
    // Notificação de um tipo que não nos interessa (ex: merchant_order). Confirma recebimento.
    return json({ ok: true }, 200);
  }

  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  const assinaturaValida = await validarAssinaturaWebhook({
    xSignature,
    xRequestId,
    dataId,
    secret: env.MP_WEBHOOK_SECRET,
  });

  if (!assinaturaValida) {
    console.warn("Webhook rejeitado: assinatura inválida", { dataId });
    return json({ erro: "Assinatura inválida" }, 401);
  }

  // Nunca confiar no status do payload do webhook: sempre reconsultar a API do MP.
  let pagamento;
  try {
    pagamento = await consultarPagamento({ accessToken: env.MP_ACCESS_TOKEN, paymentId: dataId });
  } catch (erro) {
    console.error("Erro ao consultar pagamento", erro);
    // Erro nosso/de rede: deixa o MP reenviar depois.
    return json({ erro: "Falha ao consultar pagamento" }, 502);
  }

  const barId = pagamento.metadata?.bar_id;
  const pedidoId = pagamento.metadata?.pedido_id;

  if (!barId || !Number.isFinite(pedidoId)) {
    console.warn("Webhook ignorado: pagamento sem metadata de bar/pedido", { dataId });
    return json({ ok: true }, 200);
  }

  if (!(await barExiste(env.FIREBASE_DATABASE_URL, barId, env.FIREBASE_SERVICE_ACCOUNT_JSON))) {
    // Bar inexistente: ignora silenciosamente (200) em vez de expor erro ao chamador.
    console.warn("Webhook ignorado: barId inexistente", { barId, dataId });
    return json({ ok: true }, 200);
  }

  if (await pagamentoJaProcessado(env.FIREBASE_DATABASE_URL, dataId, env.FIREBASE_SERVICE_ACCOUNT_JSON)) {
    // Idempotência: o MP pode reenviar a mesma notificação várias vezes.
    return json({ ok: true, jaProcessado: true }, 200);
  }

  if (pagamento.status !== "approved") {
    // pending, rejected, cancelled etc. — nada a fazer na fila.
    return json({ ok: true, status: pagamento.status }, 200);
  }

  try {
    await furarFila({
      databaseURL: env.FIREBASE_DATABASE_URL,
      barId,
      pedidoId,
      paymentId: dataId,
      valorCentavos: pagamento.transaction_amount * 100,
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    });
  } catch (erro) {
    console.error("Erro ao reordenar a fila", erro);
    return json({ erro: "Falha ao reordenar a fila" }, 502);
  }

  return json({ ok: true, reordenado: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "POST" && url.pathname === "/criar-cobranca") {
      return handleCriarCobranca(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhook-pix") {
      return handleWebhookPix(request, env);
    }

    return json({ erro: "Não encontrado" }, 404);
  },
};
