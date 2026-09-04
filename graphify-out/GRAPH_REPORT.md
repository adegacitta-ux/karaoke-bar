# Graph Report - karaoke-bar  (2026-08-28)

## Corpus Check
- Corpus is ~35,871 words - fits in a single context window. You may not need a graph.

## Summary
- 86 nodes · 127 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 90% EXTRACTED · 8% INFERRED · 2% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.86)
- Token cost: 141,661 input · 0 output

## Community Hubs (Navigation)
- Project Docs & Entry Pages
- Payment Worker & MercadoPago
- Queue Ordering Logic
- Firebase REST Helpers
- Worker Build Config
- Webhook Signature Validation
- Firebase Queue Sync
- DJ Admin Authentication
- Time-Based Queue Lock

## God Nodes (most connected - your core abstractions)
1. `furarFila()` - 8 edges
2. `handleCriarCobranca()` - 8 edges
3. `handleWebhookPix()` - 8 edges
4. `obterAccessToken()` - 6 edges
5. `fbGet()` - 6 edges
6. `validarAssinaturaWebhook()` - 6 edges
7. `index.html (Karaokê Manager App)` - 6 edges
8. `pix-fura-fila-sandbox README` - 6 edges
9. `TESTES.md (Roteiro de Testes Manuais)` - 6 edges
10. `fila-v2-sandbox/index.html (ported v2 front-end + Furar Fila)` - 6 edges

## Surprising Connections (you probably didn't know these)
- `acaoProximo()` --semantically_similar_to--> `acaoProximo() (v2 sandbox)`  [INFERRED] [semantically similar]
  index.html → pix-fura-fila-sandbox/fila-v2-sandbox/index.html
- `acaoFinalizarApresentacao()` --semantically_similar_to--> `acaoFinalizarApresentacao() (v2 sandbox)`  [INFERRED] [semantically similar]
  index.html → pix-fura-fila-sandbox/fila-v2-sandbox/index.html
- `handleAdminAuthSubmit()` --semantically_similar_to--> `checkAuth()`  [INFERRED] [semantically similar]
  index.html → dj-login.html
- `Priorização por Rodadas (fairness algorithm)` --rationale_for--> `ordenarFila() (v2 sandbox, extended for Furar Fila)`  [INFERRED]
  README.md → pix-fura-fila-sandbox/fila-v2-sandbox/index.html
- `Karaokê Manager README` --references--> `index.html (Karaokê Manager App)`  [EXTRACTED]
  README.md → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Firebase Realtime Database live-sync pattern** — index_index, display_display, pix_fura_fila_sandbox_fila_v2_sandbox_index_index [INFERRED 0.85]
- **Client-side DJ/Admin authentication approaches** — index_index, dj_login_dj_login, pix_fura_fila_sandbox_fila_v2_sandbox_index_index [INFERRED 0.75]
- **PIX fura-fila sandbox validation flow (Fase 1 -> Fase 2)** — pix_fura_fila_sandbox_readme_readme, pix_fura_fila_sandbox_docs_testes_testes, pix_fura_fila_sandbox_fila_v2_sandbox_index_index, pix_fura_fila_sandbox_frontend_index_index [EXTRACTED 1.00]

## Communities (11 total, 1 thin omitted)

### Community 0 - "Project Docs & Entry Pages"
Cohesion: 0.16
Nodes (13): display.html (Painel de Exibição / Telão), dj-login.html (DJ Login Gate Template), index.html (Karaokê Manager App), TESTES.md (Roteiro de Testes Manuais), fila-v2-sandbox/index.html (ported v2 front-end + Furar Fila), frontend/index.html (Fase 1 front-end, aposentado) (+7 more)

### Community 1 - "Payment Worker & MercadoPago"
Cohesion: 0.29
Nodes (12): barExiste(), CORS_HEADERS, fetch(), handleCriarCobranca(), handleWebhookPix(), json(), CARTAO_TESTE, consultarPagamento() (+4 more)

### Community 2 - "Queue Ordering Logic"
Cohesion: 0.18
Nodes (10): acaoFinalizarApresentacao(), acaoProximo(), adicionarPedido(), obterChaveNome(), ordenarFila(), acaoFinalizarApresentacao() (v2 sandbox), acaoProximo() (v2 sandbox), ordenarFila() (v2 sandbox, extended for Furar Fila) (+2 more)

### Community 3 - "Firebase REST Helpers"
Cohesion: 0.39
Nodes (11): base64url(), fbGet(), fbGetComETag(), fbPut(), furarFila(), normalizarComoArray(), obterAccessToken(), pagamentoJaProcessado() (+3 more)

### Community 4 - "Worker Build Config"
Cohesion: 0.18
Nodes (10): devDependencies, wrangler, name, private, scripts, deploy, dev, tail (+2 more)

### Community 5 - "Webhook Signature Validation"
Cohesion: 0.53
Nodes (4): bytesToHex(), compararConstante(), parseXSignature(), validarAssinaturaWebhook()

### Community 6 - "Firebase Queue Sync"
Cohesion: 0.40
Nodes (4): atualizarDisplayWithData(), initFirebase() (display), salvarNoFirebase(), Persistência via localStorage (client-only fallback)

### Community 7 - "DJ Admin Authentication"
Cohesion: 0.50
Nodes (3): checkAuth(), Client-Side Admin/DJ Password Gate, handleAdminAuthSubmit()

## Knowledge Gaps
- **13 isolated node(s):** `name`, `private`, `version`, `dev`, `deploy` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `furarFila()` connect `Firebase REST Helpers` to `Payment Worker & MercadoPago`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._