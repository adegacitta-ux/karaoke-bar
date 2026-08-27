# PIX "Fura-fila" — ambiente sandbox isolado

Ambiente de teste ponta a ponta (cobrança PIX → webhook → reordenação da fila) para
validar a lógica de "pagar para furar a fila" do Cantokê, sem exigir cartão de
crédito e sem custo:

- **Firebase Realtime Database** no plano Spark (grátis, sem Cloud Functions) —
  projeto **`karaokebar-7a67f`**, já existente, associado a este repositório
- **Cloudflare Workers** (free tier) para receber o webhook do Mercado Pago
- **Mercado Pago Sandbox** (credenciais `TEST-...`) para simular cobranças PIX

## ⚠️ Inversão de ambientes — leia antes de tudo

Neste ponto do projeto, **`karaoke-bar`** (este repositório) é o ambiente de
teste/sandbox, e **`karaoke-bar-v2`** é produção (site ao vivo). Todo o código deste
diretório vive isolado em `pix-fura-fila-sandbox/`, dentro deste repo — nenhum arquivo
de produção deste repo (`index.html`, `display.html`, `dj-login.html`) foi tocado, e
nada foi escrito no repositório `karaoke-bar-v2` (só leitura, para auditoria).

## Fase 1 vs Fase 2

- **Fase 1** implementou o Worker do PIX (`worker/`) contra um schema de fila que eu
  inventei (map por nome). Funcional, mas não integrado a uma fila real.
- **Fase 2** auditou o `karaoke-bar-v2` (produção real) e descobriu que o schema
  verdadeiro é diferente — `fila` é um **array de pedidos**, identificados por `id`
  numérico, com um algoritmo de fairness específico. Portei essa fila de verdade para
  `fila-v2-sandbox/` e atualizei o Worker (`worker/src/firebase.js`) para escrever
  nesse schema real, em vez do que eu tinha assumido. **`fila-v2-sandbox/index.html` é
  o front-end de teste válido agora** — o antigo `frontend/index.html` da Fase 1 ficou
  obsoleto (o schema que ele assumia não existe) e foi substituído por um aviso.

## O que eu não pude fazer

- **Criar contas reais** (Mercado Pago Developers, Cloudflare) exige login humano em
  consoles externos para os quais esta sessão não tem credenciais.
- **Acessar o Firebase `karaokebar-7a67f` ao vivo**: a política de rede desta sessão
  bloqueia `firebaseio.com` (testei uma leitura anônima e não-destrutiva; o proxy
  recusou com 403 e a própria política diz para reportar o host bloqueado, não
  contornar — nem uma service account key resolveria, o bloqueio é de rede, não de
  autorização). Por isso pedi pro usuário confirmar manualmente no console:
  - ✅ **Plano confirmado: Spark** (2026-08-27, confirmado pelo usuário via
    Configurações do projeto → Uso e faturamento)
  - ✅ **Estrutura raiz do banco confirmada**: existe só o nó `karaoke` na raiz (dados
    legados, sem o padrão multi-tenant `/bares/{barId}/...`) — **não há nenhum nó
    `bares` ainda**, então `firebase/database.rules.json` e
    `firebase/seed-teste-pix-sandbox.json` (que escrevem em
    `bares/teste-pix-sandbox/...`) são estritamente aditivos: criam uma chave irmã
    nova, sem tocar no `karaoke` legado.
  - ✅ **Regras publicadas e seed importado** (2026-08-27, feito pelo usuário via
    console) — `bares/teste-pix-sandbox` existe agora com `config` + 3 pedidos de
    teste, e as regras de `firebase/database.rules.json` estão no ar. O `/karaoke`
    legado na raiz permanece intocado.
  - Ainda pendente (só o usuário pode fazer, via console/dashboards): criar o usuário
    de Authentication, gerar a service account key, criar a aplicação no Mercado Pago
    e fazer o deploy do Worker (Passos 1.6, 1.7, 2 e 3 abaixo).
- Os testes do Passo 8 / Fase 2 passo 6 (`docs/TESTES.md`) estão documentados como
  checklist, não executados.

## Passo a passo para colocar no ar

### 1. Firebase (`karaokebar-7a67f`, já existente)
1. Abra https://console.firebase.google.com/project/karaokebar-7a67f
2. ~~Confirme o plano~~ ✅ **Spark confirmado** (2026-08-27).
3. ~~Audite os `barId`s existentes~~ ✅ **Confirmado**: a raiz do banco só tem o nó
   `karaoke` (dados legados) — não existe nenhum nó `bares` ainda, então não há
   colisão possível com `bares/teste-pix-sandbox`.
4. ~~Publique as regras~~ ✅ **Feito** (2026-08-27) — `firebase/database.rules.json`
   está publicado, restrito a `bares/teste-pix-sandbox`.
5. ~~Importe os dados de teste~~ ✅ **Feito** (2026-08-27) — `bares/teste-pix-sandbox`
   tem `config` + os 3 pedidos de `firebase/seed-teste-pix-sandbox.json`.
6. **Authentication**: confirme que já existe (ou crie) um usuário de e-mail/senha com
   o e-mail usado em `config.adminEmail` no seed (`admin@cantoke.dev`, ou o que você
   ajustar) — é a conta de DJ para o bar de teste.
7. Configurações do projeto → Contas de serviço → gere (ou reaproveite) uma chave
   privada JSON. **Nunca commite esse arquivo.**

### 2. Mercado Pago Developers
1. Crie uma aplicação em https://www.mercadopago.com.br/developers/panel/app
2. Copie o **Access Token de teste** (`TEST-...`).
3. Em "Notificações" (Webhooks), cadastre `https://<seu-worker>.workers.dev/webhook-pix`
   e copie a **assinatura secreta** — é o `MP_WEBHOOK_SECRET`.
4. Em "Usuários de teste", crie pelo menos um comprador e um vendedor.

### 3. Cloudflare Worker
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON   # cole o JSON inteiro em uma linha
```
O `FIREBASE_DATABASE_URL` em `wrangler.toml` já está correto
(`https://karaokebar-7a67f-default-rtdb.firebaseio.com`, batendo com o
`firebaseConfig.databaseURL` real gerado pelo console) — não precisa ajustar.
(Correção: uma versão anterior deste README afirmava isso sem eu ter de fato
conferido o arquivo — o valor ainda estava com o nome de projeto da Fase 1
`cantoke-pix-sandbox`, que nunca chegou a ser criado. Só foi corrigido depois que o
`wrangler tail` mostrou o 404 real durante os testes.) Ajuste `PRECO_FURAR_FILA_CENTAVOS`
se quiser um valor diferente de R$10,00. O preço NUNCA é aceito do cliente.

```bash
npx wrangler deploy
```

Local antes do deploy: copie `.dev.vars.example` para `.dev.vars` (ignorado pelo git),
preencha com valores reais e rode `npm run dev`.

**Rate limiting:** a defesa recomendada é uma *Rate Limiting Rule* no painel da
Cloudflare (WAF → Rate limiting rules), grátis em qualquer plano. Como camada extra,
`src/rateLimit.js` já inclui um limitador em código via KV opcional — sem o binding,
ele simplesmente não limita (não quebra o Worker). Para ativar:
`npx wrangler kv namespace create RATE_LIMIT` e cole o `id` no bloco comentado do
`wrangler.toml`.

### 4. Front-end de teste (`fila-v2-sandbox/`)
`fila-v2-sandbox/index.html` já vem com `firebaseConfig.apiKey`, `PIX_WORKER_URL` e
`BAR_ID` (fixo em `'teste-pix-sandbox'` — não deve ser alterado para aceitar outros
bares) preenchidos e commitados.

**Rodar localmente** — abrir o arquivo direto no navegador (`file://...`) funciona na
maior parte do tempo, mas alguns navegadores restringem módulos ES (`type="module"`,
usado pelo SDK do Firebase) em `file://`. Se a página carregar em branco ou o console
mostrar erro de CORS/módulo, sirva por HTTP em vez de abrir o arquivo direto — dentro
de `fila-v2-sandbox/`, qualquer um destes já resolve, sem instalar nada globalmente:

```bash
python3 -m http.server 8080      # já vem com o Python — 100% built-in
# ou
npx serve -l 8080                # usa o Node que você já tem pro Worker
```

Depois abra `http://localhost:8080` no navegador.

A aba "Cliente" mostra a lista "Próximos" com o botão "Furar fila" por pedido; a aba
"Admin/DJ" (login com o `adminEmail` do seed) mostra a fila completa com as ações
normais (Chamar Próximo, Pular Vez, Remover).

`display.html` e `catalogo.html` do v2 **não foram portados** — fora do escopo de
validar a reordenação da fila pelo PIX.

### 5. Testes
Siga `docs/TESTES.md`.

## Decisões de design que valem explicar

- **Schema real, não o que eu supus na Fase 1**: `/bares/{barId}/karaoke/fila` é um
  array de pedidos (`{id, nome, mesa, musica, artista, timestamp, timestampFila,
  vezesCantadas, youtubeUrl}`), não um map por nome. `id` é `Date.now() + random`,
  gerado no front-end. O Worker localiza o pedido a reordenar por esse `id`
  (`pedidoId` no contrato da API), não por um "nomeId" — isso mudou o contrato de
  `/criar-cobranca` em relação à Fase 1.
- **"Transaction" via REST, no array inteiro**: a produção usa `.transaction()` do SDK
  cliente no nó `fila` inteiro (recebe o array do servidor, devolve o array
  modificado) — é isso que evita pedidos sumindo em escritas simultâneas. A API REST
  não tem `transaction()` (depende de WebSocket persistente). O equivalente aqui é
  concorrência otimista no array inteiro: GET com `X-Firebase-ETag`, localizo o pedido
  pelo `id`, PUT do array inteiro de volta com `If-Match`, retry em `412`. Está em
  `worker/src/firebase.js` → `furarFila()`.
- **Existência do bar = nó `/config`, não `/karaoke`**: espelha a produção — o v2
  mostra "bar não encontrado" quando `/bares/{barId}/config` é `null`, não quando
  `/karaoke` é.
- **Prioridade do fura-fila**: ao aprovar o pagamento, o pedido recebe
  `furouFila: true` e `furouFilaOrdem` (timestamp de servidor, `{".sv":"timestamp"}`).
  `ordenarFila()` em `fila-v2-sandbox/index.html` foi estendida (é a única mudança no
  algoritmo de fairness em si) pra sempre pôr `furouFila=true` no topo, desempatando
  por `furouFilaOrdem` — sem depender do timer de 25 min
  (`MINUTOS_PARA_PERDOAR_UMA_VEZ_CANTADA`) nem da ordem normal por `vezesCantadas`.
- **`barId` travado no código, nunca por query string**: diferente da produção
  (`?bar=citta`), o front-end portado tem `BAR_ID` como constante fixa — é a garantia
  de que este sandbox, rodando no mesmo projeto Firebase que pode ter dados reais de
  antes da inversão, não tem nenhum caminho de código que aceite um `barId` arbitrário
  vindo do usuário.
- **Preço não vem do cliente**: o Worker ignora qualquer `valor` do corpo da
  requisição e usa `PRECO_FURAR_FILA_CENTAVOS` do próprio ambiente.
- **Assinatura do webhook**: `x-signature` validada via HMAC-SHA256 (Web Crypto)
  contra o manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`, como
  documentado pelo Mercado Pago. Assinatura inválida → `401`, nada é escrito.
- **Idempotência**: `/pagamentosProcessados/{paymentId}` só é gravado depois que a
  reordenação é confirmada com sucesso — reenviar o mesmo webhook antes disso só repete
  o retry de concorrência, nunca duplica o efeito.
- **Chave do YouTube não copiada**: `fila-v2-sandbox/index.html` tem um placeholder no
  lugar da chave real do v2 (é credencial deles, não nossa). Sem chave própria, a busca
  automática de karaokê no YouTube fica indisponível, mas pedidos manuais (música +
  artista digitados) continuam funcionando normalmente.
