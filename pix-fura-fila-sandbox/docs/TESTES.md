# Roteiro de testes manuais (Passo 8 / Fase 2 passo 6)

Estes testes exigem contas reais (Firebase, Mercado Pago, Cloudflare) e dados
importados no projeto `karaokebar-7a67f` — ver `../README.md`. Este documento não foi
executado neste ambiente: a rede desta sessão bloqueia `firebaseio.com` e não há
credenciais de sandbox provisionadas aqui. Use como checklist ao rodar você mesmo.

## Pré-requisitos
- Regras publicadas (`../firebase/database.rules.json`) restritas a `teste-pix-sandbox`
- Dados importados via `../firebase/seed-teste-pix-sandbox.json` no nó
  `/bares/teste-pix-sandbox` (3 pedidos de teste, `id` 1, 2 e 3)
- Worker deployado (`wrangler deploy`) com os secrets configurados
- `notification_url` do app MP apontando para `<worker-url>/webhook-pix`
- `../fila-v2-sandbox/index.html` aberto no navegador, com `firebaseConfig` e
  `PIX_WORKER_URL` preenchidos

## Modo de teste com cartão (webhook ponta a ponta, sem PIX real)

O sandbox do Mercado Pago não deixa completar um PIX de verdade — só gera o QR code,
não existe "pagador de teste" pra PIX. Pra validar o fluxo completo (webhook →
assinatura → idempotência → reordenação da fila via transaction) sem depender disso,
o Worker tem um modo de teste com cartão, **desligado por padrão** (`wrangler.toml`
comentado — o caminho normal é sempre PIX).

**Ativar só para um deploy** (não mexe no `wrangler.toml` commitado):
```bash
npx wrangler deploy --var TEST_PAYMENT_METHOD:card
```
**Desativar de novo** (volta ao PIX normal):
```bash
npx wrangler deploy
```

Com o modo ativo, `POST /criar-cobranca` aceita um campo opcional `cardholderTeste`
que controla o resultado simulado (default `"APRO"` = aprovado automaticamente, sem
ação manual — dispara o webhook de aprovação de verdade):

| `cardholderTeste` | Resultado simulado |
|---|---|
| `APRO` (padrão) | Aprovado |
| `OTHE` | Recusado (genérico) |
| `CONT` | Pendente |
| `CALL` | Recusado (autorização) |
| `FUND` | Recusado (saldo insuficiente) |
| `SECU` | Recusado (CVV inválido) |

```bash
curl -X POST https://<worker-url>/criar-cobranca \
  -H "Content-Type: application/json" \
  -d '{"barId":"teste-pix-sandbox","pedidoId":1,"cardholderTeste":"APRO"}'
```

A resposta não tem `qrCode`/`qrCodeBase64` (não é PIX) — só `paymentId` e `status`.
Com `APRO`, o pagamento costuma vir `approved` já na criação; o webhook chega
separado, e o resto do fluxo (testes 2-6 abaixo) funciona igual.

## 1. Criar cobrança
```bash
curl -X POST https://<worker-url>/criar-cobranca \
  -H "Content-Type: application/json" \
  -d '{"barId":"teste-pix-sandbox","pedidoId":1,"payerEmail":"comprador-teste@testuser.com"}'
```
**Esperado:** `200` com `paymentId`, `qrCode` e `qrCodeBase64` não nulos. Testar também
com um `pedidoId` inexistente (ex: `999`) — esperado `404` com
`{"erro":"Pedido não encontrado na fila"}`.

## 2. Pagamento aprovado → fila reordena
1. Clique em "Furar fila" no pedido de `id: 1` (Ana Teste) na página portada, ou repita
   o curl acima e pague o PIX gerado com o usuário de teste comprador.
2. Aguarde o webhook chegar em `/webhook-pix` (ou confira `wrangler tail`).
3. Confira que o pedido `id: 1` no array `/bares/teste-pix-sandbox/karaoke/fila` ganhou
   `furouFila: true` e `furouFilaOrdem` (timestamp de servidor).

**Esperado:** "Ana Teste" sobe para o topo da lista "Próximos" no front-end, com o
badge "FUROU A FILA", à frente de Bruno e Carla mesmo que eles estejam esperando há
mais tempo.

## 3. Pagamento pendente/rejeitado → nada muda
Crie uma cobrança e não pague. Confirme que nenhum webhook com `status=approved` chega
e que o pedido permanece sem `furouFila` no array.

## 4. Reenvio do mesmo webhook → idempotência
No painel do Mercado Pago (Webhooks → histórico), use "Reenviar" na notificação já
processada, ou repita manualmente:
```bash
curl -X POST "https://<worker-url>/webhook-pix?type=payment&data.id=<payment_id>" \
  -H "x-signature: ts=...,v1=..." \
  -H "x-request-id: <mesmo-request-id-original>"
```
**Esperado:** `200` com `{"ok":true,"jaProcessado":true}`; o `processadoEm` em
`/pagamentosProcessados/<payment_id>` continua com o timestamp da primeira vez, e o
array `fila` não é reescrito de novo.

## 5. Assinatura inválida → rejeitado
```bash
curl -X POST "https://<worker-url>/webhook-pix?type=payment&data.id=123" \
  -H "x-signature: ts=1,v1=assinaturafalsa" \
  -H "x-request-id: abc"
```
**Esperado:** `401` com `{"erro":"Assinatura inválida"}`, e nada é escrito no Firebase.

## 6. Dois furadores em sequência → desempate por ordem de pagamento
Repita o teste 2 para os pedidos `id: 2` (Bruno) e `id: 3` (Carla), pagando o de Carla
~10s depois do de Bruno. Confirme no front-end que ambos aparecem com o badge, com
Bruno acima de Carla (pagou primeiro), e ambos acima da fila normal restante.

## 7. Isolamento do barId de teste (checklist de segurança da Fase 2)
- Confirme que `fila-v2-sandbox/index.html` não tem nenhum campo/URL que aceite um
  `barId` diferente de `teste-pix-sandbox` (o valor é uma constante no código).
- Tente uma cobrança para outro `barId` (`curl ... -d '{"barId":"algum-bar-real",...}'`)
  e confirme que o Worker responde `404 Bar não encontrado` a menos que esse bar
  também tenha um nó `/config` — e mesmo assim, confirme manualmente que esse `barId`
  não existe de verdade no `karaokebar-7a67f` antes de rodar esse teste específico.
