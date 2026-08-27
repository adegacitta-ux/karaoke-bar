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

/** Confere se o bar existe antes de processar qualquer cobrança/webhook. */
export async function barExiste(databaseURL, barId, serviceAccountJson) {
  const dados = await fbGet(databaseURL, `/bares/${barId}/karaoke`, serviceAccountJson);
  return dados !== null;
}

export async function pagamentoJaProcessado(databaseURL, paymentId, serviceAccountJson) {
  const dados = await fbGet(databaseURL, `/pagamentosProcessados/${paymentId}`, serviceAccountJson);
  return dados !== null;
}

/**
 * Move um nome para o topo absoluto da fila (fura-fila), de forma idempotente e
 * segura contra concorrência (retry em caso de escrita simultânea no mesmo nó).
 *
 * Critério: furouFila=true sempre vence a ordenação normal. Entre furadores,
 * quem confirmou o pagamento primeiro (furouFilaOrdem menor) fica na frente —
 * ver frontend/index.html para o comparator que aplica essa regra na exibição.
 */
export async function furarFila({ databaseURL, barId, nomeId, paymentId, valorCentavos, serviceAccountJson }) {
  const accessToken = await obterAccessToken(serviceAccountJson);
  const pathNome = `/bares/${barId}/karaoke/fila/${nomeId}`;

  const MAX_TENTATIVAS = 5;
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const { valor: nomeAtual, etag } = await fbGetComETag(databaseURL, pathNome, accessToken);

    if (nomeAtual === null) {
      throw Object.assign(new Error(`Nome ${nomeId} não encontrado na fila do bar ${barId}`), { codigo: "NOME_NAO_ENCONTRADO" });
    }

    const atualizado = {
      ...nomeAtual,
      furouFila: true,
      furouFilaOrdem: { ".sv": "timestamp" },
      furouFilaPaymentId: paymentId,
    };

    const resp = await fetch(urlPara(databaseURL, pathNome), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": etag,
      },
      body: JSON.stringify(atualizado),
    });

    if (resp.ok) {
      // Idempotência: registra o pagamento como processado só depois do sucesso da reordenação.
      await fbPut(
        databaseURL,
        `/pagamentosProcessados/${paymentId}`,
        {
          barId,
          nomeId,
          valorCentavos,
          processadoEm: { ".sv": "timestamp" },
        },
        serviceAccountJson
      );
      return { ok: true, tentativas: tentativa + 1 };
    }

    if (resp.status === 412) {
      // Conflito de concorrência (outra escrita mudou o nó entre o GET e o PUT). Retry.
      continue;
    }

    throw new Error(`Firebase PUT ${pathNome} falhou (status ${resp.status}): ${await resp.text()}`);
  }

  throw new Error(`Não foi possível reordenar a fila após ${MAX_TENTATIVAS} tentativas (conflitos de concorrência)`);
}
