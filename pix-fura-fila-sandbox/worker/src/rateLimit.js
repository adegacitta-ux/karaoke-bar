// Rate limiting básico por IP para /criar-cobranca.
//
// A defesa "nativa" recomendada pelo Passo 4 é uma Rate Limiting Rule do painel da
// Cloudflare (WAF → Rate limiting rules), que roda antes mesmo do Worker ser invocado
// e está disponível de graça em qualquer plano — configure-a no dashboard, veja o
// README. Isto aqui é uma segunda camada, em código, usando KV (opcional: se o
// binding RATE_LIMIT não estiver configurado, a checagem é pulada em vez de quebrar
// o Worker).

const JANELA_SEGUNDOS = 60;
const LIMITE_REQUISICOES = 5;

export async function permitido(env, ip) {
  if (!env.RATE_LIMIT) return true; // KV não configurado: sem checagem em código.

  const chave = `criar-cobranca:${ip}`;
  const atual = parseInt((await env.RATE_LIMIT.get(chave)) ?? "0", 10);

  if (atual >= LIMITE_REQUISICOES) return false;

  await env.RATE_LIMIT.put(chave, String(atual + 1), { expirationTtl: JANELA_SEGUNDOS });
  return true;
}
