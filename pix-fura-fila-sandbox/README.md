# PIX "Fura-fila" — ambiente sandbox isolado

Ambiente de teste ponta a ponta (cobrança PIX → webhook → reordenação da fila) para
validar a lógica de "pagar para furar a fila" do Cantokê, sem exigir cartão de
crédito e sem custo:

- **Firebase Realtime Database** no plano Spark (grátis, sem Cloud Functions)
- **Cloudflare Workers** (free tier) para receber o webhook do Mercado Pago
- **Mercado Pago Sandbox** (credenciais `TEST-...`) para simular cobranças PIX

Este código vive isolado nesta pasta, dentro da branch `claude/pix-fura-fila-sandbox-5q13zx`
deste repositório — nenhum arquivo de produção (`index.html`, `display.html`,
`dj-login.html`, etc.) foi tocado. O plano original previa um repositório totalmente
separado; como o acesso desta sessão ao GitHub está restrito a este repositório, o
código ficou aqui, isolado em pasta própria (decisão confirmada com o usuário).

## O que eu não pude fazer

Criar contas e projetos reais (Passos 1 e 2 do roteiro original) exige login humano
em consoles externos — Firebase Console, Mercado Pago Developers, Cloudflare
dashboard — para os quais esta sessão não tem credenciais. Também não há um projeto
de sandbox já provisionado para eu rodar `curl` contra ele, então os testes do
Passo 8 (`docs/TESTES.md`) estão documentados como checklist, não executados.
O que entreguei é **todo o código e configuração** (Worker, regras de segurança,
front-end de teste) pronto para você apontar para as contas reais.

## Passo a passo para colocar no ar

### 1. Firebase (Spark)
1. Crie um projeto novo em https://console.firebase.google.com chamado
   `cantoke-pix-sandbox` (ou o nome que preferir).
2. Ative **Realtime Database** (comece em modo restritivo — as regras finais estão
   em `firebase/database.rules.json`) e **Authentication** (e-mail/senha, um único
   admin, mesmo padrão do v2).
3. Confirme que o projeto está no plano **Spark** (Configurações do projeto → Uso e
   faturamento) — não faça upgrade para Blaze.
4. Configurações do projeto → Contas de serviço → **Gerar nova chave privada**.
   Baixe o JSON. **Nunca commite esse arquivo.**
5. Publique as regras: no console, cole o conteúdo de `firebase/database.rules.json`
   em Realtime Database → Regras → Publicar.
   - Leitura pública em `/bares/{barId}/karaoke` (o front-end escuta a fila em tempo
     real); escrita só para o e-mail admin autenticado (ajuste `admin@cantoke.dev`
     no arquivo de regras).
   - `/pagamentosProcessados` fechado (leitura e escrita `false`) — só o Worker
     acessa, via token de service account, que ignora as regras.
   - Repare que a regra de escrita fica no nível `karaoke`, não isolada em `fila` —
     é o padrão já validado no v2 para evitar `permission_denied` ao escrever nós
     relacionados na mesma operação.

### 2. Mercado Pago Developers
1. Crie uma aplicação em https://www.mercadopago.com.br/developers/panel/app
2. Copie o **Access Token de teste** (`TEST-...`).
3. Em "Notificações" (Webhooks), cadastre a URL `https://<seu-worker>.workers.dev/webhook-pix`
   e copie a **assinatura secreta** gerada — é o `MP_WEBHOOK_SECRET`.
4. Em "Usuários de teste", crie pelo menos um comprador e um vendedor.

### 3. Cloudflare Worker
```bash
cd worker
npm install
npx wrangler login          # abre o navegador para autenticar
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON   # cole o JSON inteiro em uma linha
```
Ajuste `FIREBASE_DATABASE_URL` e `PRECO_FURAR_FILA_CENTAVOS` em `wrangler.toml`
(este último é o preço em centavos — o valor NUNCA é aceito do cliente, por
segurança, mesmo que o front-end envie um `valor` no body).

```bash
npx wrangler deploy
```

Para rodar localmente antes do deploy: copie `.dev.vars.example` para `.dev.vars`
(já ignorado pelo git), preencha com valores reais e rode `npm run dev`.

**Rate limiting:** o Passo 4 pede limitar `/criar-cobranca`. A defesa recomendada é
uma *Rate Limiting Rule* no painel da Cloudflare (WAF → Rate limiting rules),
gratuita em qualquer plano, e roda antes do Worker. Como camada extra, o Worker já
inclui um limitador em código (`src/rateLimit.js`) que usa um KV namespace opcional
— sem o binding configurado, ele simplesmente não limita nada (não quebra o Worker).
Para ativar: `npx wrangler kv namespace create RATE_LIMIT` e cole o `id` retornado
no bloco comentado do `wrangler.toml`.

### 4. Front-end de teste
Edite `frontend/index.html`: preencha `CONFIG.firebaseConfig` (dados públicos do
app, em Configurações do projeto → Seus apps), `CONFIG.workerUrl` (URL do Worker
publicado) e `CONFIG.barId`. Abra o arquivo direto no navegador ou sirva com
`python -m http.server` dentro de `frontend/`.

Crie o nó de teste no Firebase (`/bares/bar-teste/karaoke/fila/nome-teste`) com pelo
menos `{ "nome": "Fulano" }` antes de testar.

### 5. Testes
Siga `docs/TESTES.md`.

## Decisões de design que valem explicar

- **"Transaction" via REST:** a API REST do Realtime Database não expõe o
  `transaction()` do SDK cliente (depende de WebSocket persistente, incompatível
  com o modelo stateless de um Worker). O equivalente correto aqui é concorrência
  otimista com ETag — leio o nó com `X-Firebase-ETag`, escrevo com `If-Match`, e
  faço retry em caso de `412` (conflito). Está em `worker/src/firebase.js` →
  `furarFila()`.
- **Prioridade do fura-fila:** ao aprovar o pagamento, o nome recebe
  `furouFila: true` e `furouFilaOrdem` (timestamp de servidor do Firebase, via
  `{".sv":"timestamp"}`). O comparator do front-end (`frontend/index.html`) sempre
  põe `furouFila=true` no topo, e desempata por `furouFilaOrdem` — sem depender do
  timer de 25 min (`MINUTOS_PARA_PERDOAR_UMA_VEZ_CANTADA`) nem da ordem normal.
- **Preço não vem do cliente:** apesar do endpoint aceitar `valor` no corpo original
  do pedido, o Worker ignora esse campo e usa `PRECO_FURAR_FILA_CENTAVOS` do próprio
  ambiente — evita que alguém manipule a requisição para pagar um valor arbitrário.
- **Assinatura do webhook:** `x-signature` é validada via HMAC-SHA256 (Web Crypto)
  contra o manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`, exatamente
  como documentado pelo Mercado Pago. Assinatura inválida → `401` e nada é escrito.
- **Idempotência:** `/pagamentosProcessados/{paymentId}` só é gravado depois que a
  reordenação da fila é confirmada com sucesso — um reenvio do mesmo webhook antes
  disso apenas repete o retry de concorrência, nunca duplica o efeito.
