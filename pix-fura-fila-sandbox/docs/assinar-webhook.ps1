# Gera uma assinatura x-signature válida do Mercado Pago e chama POST /webhook-pix,
# simulando o MP reenviando a notificação de um pagamento já processado (teste de
# idempotência - ver docs/TESTES.md, cenário 4).
#
# O MP_WEBHOOK_SECRET nunca sai da sua máquina - não roda em nenhum lugar além daqui.
#
# Uso (de dentro do cmd, sem precisar trocar de terminal):
#   set MP_WEBHOOK_SECRET=o_segredo_que_voce_configurou_no_app_do_mp
#   powershell -ExecutionPolicy Bypass -File assinar-webhook.ps1 -PaymentId 1327986726
#
# Ou passando o segredo direto (fica no histórico do shell - prefira o env var acima):
#   powershell -ExecutionPolicy Bypass -File assinar-webhook.ps1 -PaymentId 1327986726 -Secret "..."

param(
    [Parameter(Mandatory = $true)][string]$PaymentId,
    [string]$WorkerUrl = "https://cantoke-pix-sandbox.cantoke-sandbox-2026.workers.dev",
    [string]$Secret = $env:MP_WEBHOOK_SECRET
)

if ([string]::IsNullOrEmpty($Secret)) {
    Write-Error "Faltou o segredo. Defina 'set MP_WEBHOOK_SECRET=...' antes, ou passe -Secret."
    exit 1
}

$ts = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$requestId = [guid]::NewGuid().ToString()
$dataIdLower = $PaymentId.ToLower()

# Manifest exatamente como validarAssinatura.js monta no Worker:
# id:{data.id};request-id:{x-request-id};ts:{ts};
$manifest = "id:$dataIdLower;request-id:$requestId;ts:$ts;"

$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
$hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($manifest))
$hashHex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })

$xSignature = "ts=$ts,v1=$hashHex"

Write-Host "URL:          $WorkerUrl/webhook-pix?type=payment&data.id=$PaymentId"
Write-Host "x-signature:  $xSignature"
Write-Host "x-request-id: $requestId"
Write-Host ""

curl.exe -i -X POST "$WorkerUrl/webhook-pix?type=payment&data.id=$PaymentId" `
  -H "Content-Type: application/json" `
  -H "x-signature: $xSignature" `
  -H "x-request-id: $requestId" `
  -d "{}"
