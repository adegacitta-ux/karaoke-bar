# Roteiro de testes manuais (Passo 8)

Estes testes exigem contas reais (Firebase, Mercado Pago, Cloudflare) que precisam
ser criadas manualmente — ver `../README.md`. Este documento não foi executado
neste ambiente: aqui não há credenciais de sandbox provisionadas nem acesso aos
consoles do Firebase/Mercado Pago/Cloudflare. Use-o como checklist ao rodar você
mesmo os testes.

## Pré-requisitos
- Worker deployado (`wrangler deploy`) com os secrets configurados
- `notification_url` do app MP apontando para `<worker-url>/webhook-pix`
- Um nó de teste em `/bares/bar-teste/karaoke/fila/nome-teste` com `{ "nome": "Fulano" }`
- Dois usuários de teste do Mercado Pago (comprador e vendedor)

## 1. Criar cobrança
```bash
curl -X POST https://<worker-url>/criar-cobranca \
  -H "Content-Type: application/json" \
  -d '{"barId":"bar-teste","nomeId":"nome-teste","payerEmail":"comprador-teste@testuser.com"}'
```
**Esperado:** `200` com `paymentId`, `qrCode` e `qrCodeBase64` não nulos.

## 2. Pagamento aprovado → fila reordena
1. Pague o PIX usando o app/simulador do usuário de teste comprador.
2. Aguarde o webhook chegar em `/webhook-pix` (ou confira `wrangler tail`).
3. Confira no Firebase Console (ou via listener do `frontend/index.html`) que
   `/bares/bar-teste/karaoke/fila/nome-teste/furouFila` virou `true`.

**Esperado:** nome sobe para o topo da lista renderizada pelo front-end.

## 3. Pagamento pendente/rejeitado → nada muda
Crie uma cobrança e não pague (ou use um cartão de teste de rejeição, se aplicável
ao fluxo). Confirme que nenhum webhook com `status=approved` chega e que o nó do
nome na fila permanece sem `furouFila`.

## 4. Reenvio do mesmo webhook → idempotência
No painel do Mercado Pago (Webhooks → histórico de notificações), use "Reenviar"
na notificação já processada, ou repita manualmente a mesma chamada ao endpoint:
```bash
curl -X POST "https://<worker-url>/webhook-pix?type=payment&data.id=<payment_id>" \
  -H "x-signature: ts=...,v1=..." \
  -H "x-request-id: <mesmo-request-id-original>"
```
**Esperado:** resposta `200` com `{"ok":true,"jaProcessado":true}` e nenhuma escrita
adicional em `/pagamentosProcessados/<payment_id>` (verifique `processadoEm` — deve
continuar com o timestamp da primeira vez).

## 5. Assinatura inválida → rejeitado
```bash
curl -X POST "https://<worker-url>/webhook-pix?type=payment&data.id=123" \
  -H "x-signature: ts=1,v1=assinaturafalsa" \
  -H "x-request-id: abc"
```
**Esperado:** `401` com `{"erro":"Assinatura inválida"}`, e nada é escrito no Firebase.

## 6. Dois furadores em sequência → desempate por ordem de pagamento
Repita o teste 2 para dois nomes diferentes, pagando o segundo ~10s depois do
primeiro. Confirme no front-end que ambos aparecem com o badge "FUROU A FILA",
com o que pagou primeiro acima do segundo, e ambos acima da fila normal.
