// Escrita autenticada no Firebase Realtime Database via REST API, a partir de um
// Cloudflare Worker (sem Admin SDK — ele depende de Node/WebSocket, indisponíveis aqui).
//
// Autenticação: assinamos um JWT com a chave privada da service account (RS256, via
// Web Crypto) e trocamos por um access_token OAuth2 do Google. Esse token, quando
// carrega o escopo firebase.database, tem privilégio equivalente ao Admin SDK e
// ignora as regras de segurança do RTDB — por isso ele nunca deve ir para o front-end.
//
// "Transaction" via REST: a API REST do RTDB não expõe o transaction() do SDK cliente
// (que depende de uma conexão WebSocket persistente). O equivalente correto para uso
// stateless é concorrência otimista com ETag: GET com X-Firebase-ETag, escreve com
// If-Match, e retry em caso de 412 (conflito). É isso que furarFila() faz abaixo.

let cachedToken = null;
let cachedTokenExpiry = 0; // epoch ms

function base64url(bytes) {
  let str = typeof bytes === "string" ? btoa(bytes) : btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemParaArrayBuffer(pem) {
  const corpo = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binario = atob(corpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

async function obterAccessToken(serviceAccountJson) {
  const agora = Date.now();
  if (cachedToken && agora < cachedTokenExpiry - 60_000) {
    return cachedToken;
  }

  const sa = JSON.parse(serviceAccountJson);
  const iat = Math.floor(agora / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claim));
  const semAssinar = `${encodedHeader}.${encodedClaim}`;

  const chavePrivada = await crypto.subtle.importKey(
    "pkcs8",
    pemParaArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    chavePrivada,
    new TextEncoder().encode(semAssinar)
  );

  const jwt = `${semAssinar}.${base64url(assinatura)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Falha ao obter access token do Google (status ${resp.status}): ${await resp.text()}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = agora + data.expires_in * 1000;
  return cachedToken;
}

function urlPara(databaseURL, path) {
  return `${databaseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}.json`;
}

async function fbGetComETag(databaseURL, path, accessToken) {
  const resp = await fetch(urlPara(databaseURL, path), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Firebase-ETag": "true",
    },
  });
  if (!resp.ok) throw new Error(`Firebase GET ${path} falhou (status ${resp.status})`);
  const etag = resp.headers.get("ETag");
  const valor = await resp.json();
  return { valor, etag };
}

export async function fbGet(databaseURL, path, serviceAccountJson) {
  const accessToken = await obterAccessToken(serviceAccountJson);
  const resp = await fetch(urlPara(databaseURL, path), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Firebase GET ${path} falhou (status ${resp.status})`);
  return resp.json();
}

export async function fbPut(databaseURL, path, valor, serviceAccountJson) {
  const accessToken = await obterAccessToken(serviceAccountJson);
  const resp = await fetch(urlPara(databaseURL, path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(valor),
  });
  if (!resp.ok) throw new Error(`Firebase PUT ${path} falhou (status ${resp.status})`);
  return resp.json();
}

/**
 * Confere se o bar existe antes de processar qualquer cobrança/webhook.
 * Espelha a produção (v2): é o nó /config que define "bar existe" — o front-end
 * do v2 mostra "bar não encontrado" quando ele é null, não quando /karaoke é null.
 */
export async function barExiste(databaseURL, barId, serviceAccountJson) {
  const dados = await fbGet(databaseURL, `/bares/${barId}/config`, serviceAccountJson);
  return dados !== null;
}

export async function pagamentoJaProcessado(databaseURL, paymentId, serviceAccountJson) {
  const dados = await fbGet(databaseURL, `/pagamentosProcessados/${paymentId}`, serviceAccountJson);
  return dados !== null;
}

// A API REST do RTDB devolve um array denso como array, mas se por algum motivo o nó
// virar esparso (ex: alguém apagou um item no meio pelo console) o Firebase devolve um
// objeto com chaves numéricas em string — normaliza pros dois casos.
function normalizarComoArray(valor) {
  if (valor === null) return [];
  if (Array.isArray(valor)) return valor;
  return Object.keys(valor)
    .sort((a, b) => Number(a) - Number(b))
    .map((chave) => valor[chave]);
}

/** Confere se um pedido ainda está na fila antes de gerar uma cobrança pra ele. */
export async function pedidoExisteNaFila(databaseURL, barId, pedidoId, serviceAccountJson) {
  const fila = normalizarComoArray(await fbGet(databaseURL, `/bares/${barId}/karaoke/fila`, serviceAccountJson));
  return fila.some((pedido) => pedido.id === pedidoId);
}

/**
 * Move um pedido para o topo absoluto da fila (fura-fila), de forma idempotente e
 * segura contra concorrência.
 *
 * Schema real (portado da produção v2): /bares/{barId}/karaoke/fila é um ARRAY de
 * pedidos, não um map por chave — em produção o SDK cliente usa .transaction() no nó
 * inteiro pra evitar pedidos sumindo em escritas simultâneas (é a mesma race condition
 * que o Passo 6 pede pra evitar aqui). A API REST não tem transaction() (depende de
 * WebSocket persistente do SDK cliente); o equivalente aqui é ETag/If-Match no array
 * inteiro — GET com X-Firebase-ETag, acha o pedido pelo `id`, PUT do array inteiro de
 * volta com If-Match, retry em 412 (conflito, ex: o DJ salvou algo no meio do caminho).
 *
 * Critério: furouFila=true sempre vence a ordenação normal (ver ordenarFila() em
 * fila-v2-sandbox/index.html). Entre furadores, quem confirmou o pagamento primeiro
 * (furouFilaOrdem menor) fica na frente.
 */
export async function furarFila({ databaseURL, barId, pedidoId, paymentId, valorCentavos, serviceAccountJson }) {
  const accessToken = await obterAccessToken(serviceAccountJson);
  const pathFila = `/bares/${barId}/karaoke/fila`;

  const MAX_TENTATIVAS = 5;
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const { valor, etag } = await fbGetComETag(databaseURL, pathFila, accessToken);
    const fila = normalizarComoArray(valor);

    const index = fila.findIndex((pedido) => pedido.id === pedidoId);
    if (index === -1) {
      throw Object.assign(new Error(`Pedido ${pedidoId} não encontrado na fila do bar ${barId}`), {
        codigo: "PEDIDO_NAO_ENCONTRADO",
      });
    }

    const filaAtualizada = [...fila];
    filaAtualizada[index] = {
      ...fila[index],
      furouFila: true,
      furouFilaOrdem: { ".sv": "timestamp" },
      furouFilaPaymentId: paymentId,
    };

    const resp = await fetch(urlPara(databaseURL, pathFila), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(filaAtualizada),
    });

    if (resp.ok) {
      // Idempotência: registra o pagamento como processado só depois do sucesso da reordenação.
      await fbPut(
        databaseURL,
        `/pagamentosProcessados/${paymentId}`,
        {
          barId,
          pedidoId,
          valorCentavos,
          processadoEm: { ".sv": "timestamp" },
        },
        serviceAccountJson
      );
      return { ok: true, tentativas: tentativa + 1 };
    }

    if (resp.status === 412) {
      // Conflito de concorrência (outra escrita — um cliente novo na fila, o DJ usando
      // "Pular Vez"/"Remover" — mudou o nó entre o GET e o PUT). Retry.
      continue;
    }

    throw new Error(`Firebase PUT ${pathFila} falhou (status ${resp.status}): ${await resp.text()}`);
  }

  throw new Error(`Não foi possível reordenar a fila após ${MAX_TENTATIVAS} tentativas (conflitos de concorrência)`);
}
