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
  contornar). Isso significa que eu **não pude**:
  - Confirmar se o projeto está no plano Spark ou já foi movido pra Blaze
  - Listar os `barId`s reais já existentes no banco
  - Ler as regras atualmente publicadas nesse projeto
  - Importar o `firebase/seed-teste-pix-sandbox.json` ou publicar
    `firebase/database.rules.json` — isso precisa ser feito por você, manualmente
  
  Todo o código (Worker, regras, front-end portado) foi escrito para nunca referenciar
  nenhum `barId` além do `teste-pix-sandbox` fixo, exatamente para que essas
  verificações ao vivo sejam uma formalidade de confirmação, não um requisito
  bloqueante para o código estar correto — mas você precisa fazê-las antes de rodar
  qualquer teste real, como o roteiro original pedia.
- Os testes do Passo 8 / Fase 2 passo 6 (`docs/TESTES.md`) estão documentados como
  checklist, não executados.

## Passo a passo para colocar no ar

### 1. Firebase (`karaokebar-7a67f`, já existente)
1. Abra https://console.firebase.google.com/project/karaokebar-7a67f
2. **Confirme o plano**: Configurações do projeto → Uso e faturamento → deve estar em
   **Spark**. Se já estiver em Blaze, pare e me avise antes de continuar (o roteiro
   original pede isso explicitamente).
3. **Audite os `barId`s existentes** antes de escrever qualquer dado de teste: Realtime
   Database → aba Dados → expanda o nó `bares`. Anote os nomes — nenhum código deste
   sandbox deve nunca escrever neles. Se `teste-pix-sandbox` já existir com dados que
   não são seus, escolha outro nome de teste e ajuste `BAR_ID` em
   `fila-v2-sandbox/index.html` e o literal em `firebase/database.rules.json` antes de
   prosseguir.
4. **Publique as regras**: Realtime Database → Regras → cole o conteúdo de
   `firebase/database.rules.json` → Publicar. Note que essas regras só concedem
   qualquer acesso ao nó `bares/teste-pix-sandbox` — todo o resto (incluindo bares
   reais) fica implicitamente negado, sem precisar de uma regra explícita de bloqueio.
5. **Importe os dados de teste**: Realtime Database → aba Dados → clique nos `⋮`
   (menu) do nó raiz **ou** navegue até criar o nó `bares/teste-pix-sandbox` e use
   "Importar JSON" apontando pro conteúdo de `firebase/seed-teste-pix-sandbox.json`
   (ele já é o objeto completo para colar dentro de `bares/teste-pix-sandbox`, com
   `config` + 3 pedidos de teste na fila).
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
Ajuste `FIREBASE_DATABASE_URL` (deve ser a URL real de `karaokebar-7a67f`, confira no
console — o valor em `wrangler.toml` é um palpite de formato padrão) e
`PRECO_FURAR_FILA_CENTAVOS` em `wrangler.toml`. O preço NUNCA é aceito do cliente.

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
Edite `fila-v2-sandbox/index.html`: preencha `firebaseConfig.apiKey` (Configurações do
projeto → Seus apps, em `karaokebar-7a67f`) e `PIX_WORKER_URL` (URL do Worker
publicado). `BAR_ID` já está fixo em `'teste-pix-sandbox'` — não precisa (e não deve)
ser alterado para aceitar outros bares.

Abra o arquivo direto no navegador, ou sirva com `python -m http.server` dentro de
`fila-v2-sandbox/`. A aba "Cliente" mostra a lista "Próximos" com o botão "Furar fila"
por pedido; a aba "Admin/DJ" (login com o `adminEmail` do seed) mostra a fila completa
com as ações normais (Chamar Próximo, Pular Vez, Remover).

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
