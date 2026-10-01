---
spec: "Overclock Headline (Redline), MCP do Headline e Overclock ARR"
slug: "spec-09-overclock-headline"
modulo_fonte: ["09-overclock-headline"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-05-catalogo-skills-mcp-hooks"]
---
# Spec 09 — Overclock Headline

## 1. Resumo e objetivo
Overclock Headline (também "Redline") é um widget de barra de menu (macOS) / bandeja (Windows/Linux) que mostra, para cada Account de cada Provider (Claude, Codex, Antigravity/Gemini, Kimi, Cursor, Grok/Groq), o percentual usado e o tempo até zerar nas janelas de 5 horas e semanal, além de uma aba Retrospect com a eficiência semanal. Expõe os mesmos dados a agentes via MCP (tool de recomendação de conta, "headline pick"). Um widget irmão, Overclock ARR, mostra o ARR do Stripe em tempo real (parcial/sem resultado confirmado). Problema: usuários deixam cota sobrando (ex.: 20% da semana) — tese "você deve bater 100% da cota semanal e da janela de 5 h; zerar a sessão é o amadorismo" [OBS: 09 Objetivo].

## 2. Escopo e não-escopo
**Dentro:** leitura local de uso por conta, cálculo de folga/tempo, UI de bandeja, Retrospect, licença Ultra, MCP `headline`, auto-update, builds por SO.
**Fora:** decisor/roteamento que consome o MCP ([[spec-03-harness-roteamento-decisor]]); catálogo de Providers ([[spec-04-providers-e-modelos]]); registro de MCP no ADE ([[spec-05-catalogo-skills-mcp-hooks]]); billing ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); assinatura/Defender ([[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança)).
**Fase 2 (planejado no original):** Headline embutido no Overclock (backlog 1.4: medição por conta, notificações, fixar conta Claude por Workspace, troca de conta como tool MCP); projetos que mais gastam tokens no Retrospect; Overclock ARR completo [OBS: 09].

## 3. Glossário e atores
Usuário; agente/harness (consome MCP); sistema. **Window**: `five_hour`, `weekly`, `monthly` (Cursor, ciclo mensal). **Slack**: 100% − usado. **Bottleneck window**: janela de maior percentual usado. **Retrospect**: histórico semanal. **Account**/**Provider** conforme modelo canônico.

## 4. Requisitos funcionais
- **RF-09.01** DEVE listar todas as Account detectadas, agrupadas por Provider, com `used_pct` e `resets_in` por janela. [OBS: 09 Comportamento] Aceite: 2 contas Claude e 3 Codex aparecem separadas.
- **RF-09.02** DEVE suportar Providers Claude, Codex, Antigravity/Gemini, Kimi, Cursor e Grok/Groq. [OBS: 09] [LAC] método de leitura de cada um (ver Q-09.2).
- **RF-09.03** DEVE ler o consumo localmente (CLI/credenciais locais) e não enviar tokens/credenciais a servidor externo. [OBS: dia 54 "100% local"; método inferido]
- **RF-09.04** DEVE calcular tempo até reset por janela e exibir percentual; ícone da barra reflete a pior janela (bottleneck). [OBS/DEC: cálculo do bottleneck observado no MCP; ícone é DEC]
- **RF-09.05** DEVE ter aba Retrospect com histórico semanal indicando se cada janela bateu 100% ("bateu"/"não bateu"). [OBS: dias 54–56; formato: LAC]
- **RF-09.06** DEVERIA exibir a próxima sessão (queda da janela de 5 h). [OBS: dia 60]
- **RF-09.07** DEVE compartilhar sessão de login com o Overclock ADE (sem login próprio) e detectar Plan Ultra via backend, exibindo CTA "faça upgrade"/"faça login" quando ausente. [OBS: dias 56, 70]
- **RF-09.08** DEVE servir um MCP local com tools de limites (seção 6c). [OBS: dias 70, 73]
- **RF-09.09** DEVE fornecer `headline_pick` que recomende a Account com maior folga na janela gargalo antes de abrir um Pane. [OBS: 09 Funcionamento]
- **RF-09.10** DEVE atualizar automaticamente (GitHub Releases) e, no macOS, ser notarizado. [OBS]
- **RF-09.11** DEVE funcionar em macOS, Windows e Linux, com barra compacta. [OBS: dias 58, 70; conflito de disponibilidade: Q-09.1]
- **RF-09.12** DEVERIA reiniciar/reanunciar o MCP se falhar ao subir na sessão. [OBS: dia 73 (falhou e foi religado)] [DEC] health-check e retry.
- **RF-09.13** PODE (fase 2) fixar Account Claude por Workspace e notificar limites. [OBS: planejado, dia 75]
- **RF-09.14** ARR: DEVERIA exibir o ARR atual em texto na barra com seta para cima/baixo conforme o último check, usando as tools do Stripe admin. [OBS: prompt arquivo 08] Resultado final não confirmado. PODE ser entregue como app separado "Overclock ARR". [OBS]
- **RF-09.15** ARR DEVE respeitar rate limit do Stripe (risco citado). [OBS] [DEC] polling ≥60 s com backoff exponencial.

## 5. Modelo de dados
```json
// AccountUsage
{ "account_id":"claude-1","provider":"claude","label":"Conta 1",
  "windows":[{"kind":"five_hour","used_pct":99,"resets_at":"2026-01-01T13:00:00Z"},
             {"kind":"weekly","used_pct":88,"resets_at":"2026-01-02T09:00:00Z"}],
  "bottleneck":"five_hour","slack_pct":1,"sampled_at":"...","status":"ok|unavailable|auth_error" }
// RetrospectWeek
{ "week_start":"2026-01-05","account_id":"claude-1","weekly_peak_pct":100,
  "hit_100_weekly":true,"five_hour_hit_rate":0.71 }   // campos [DEC]
// ArrSample { "arr_cents": 46300000, "currency":"BRL", "delta":"up|down|flat", "sampled_at":"..." } // [DEC]
// EntitlementCache { "plan":"ultra|other","checked_at":"...","expires_at":"..." }
```
Invariantes: `0 ≤ used_pct ≤ 100`; `bottleneck` = janela com maior `used_pct`; `slack_pct = 100 − used_pct(bottleneck)`. Persistência: amostras a cada ~60 s [DEC], agregação semanal local em SQLite/JSON; credenciais nunca copiadas [DEC].

## 6. Interfaces
**(a) UI:** ícone na barra com texto compacto (ex.: "99%"); popover com cartões por Provider/Account (barra de progresso por janela, "zera em 1 h"); abas Limites e Retrospect; rodapé (versão, atualizar, sair); estado bloqueado com CTA. Exemplos observados: sessão zera em 1 h (99%), semanal em 21 h, Cursor em 17 dias, Antigravity ~4–5 h [OBS: 09].
**(b) Eventos:** `usage_sampled{account_id,windows}`, `bottleneck_changed{account_id,window}`, `window_reset{account_id,kind}`, `provider_unavailable{provider,reason}`, `arr_sampled{arr_cents,delta}`.
**(c) MCP `headline`** [DEC quanto a nomes/schemas; OBS quanto à existência de "headline pick" e listagem de limites]:
- `headline_limits` — entrada `{"provider":"string?"}`; saída `{"accounts":[AccountUsage]}`; erros `unavailable`.
- `headline_pick` — entrada `{"provider":"string","window":"five_hour|weekly|auto"}`; saída `{"account_id":"...","slack_pct":12,"reason":"maior folga na janela gargalo"}`; erro `no_account_available`.
- (fase 2) `headline_switch_account` — `{"workspace_id":"...","account_id":"..."}` [OBS: planejado dia 75].
Transporte: stdio local [DEC]. Registro no ADE conforme [[spec-05-catalogo-skills-mcp-hooks]].
**(d) Externos:** backend Overclock (Entitlement); GitHub Releases; Stripe (ARR, via Stripe admin tools).

## 7. Fluxos e algoritmos
Amostragem: a cada 60 s [DEC], para cada Provider adaptador → `AccountUsage` → recalcula bottleneck → emite eventos.
`headline_pick(provider, window)`:
1. Filtra Accounts do Provider com `status=ok`.
2. Para cada uma, `used = window=='auto' ? max(used_pct das janelas) : used_pct(window)`. [OBS: gargalo = maior % usado]
3. Escolhe menor `used` (maior folga); empate → a que reseta antes [DEC].
4. Nenhuma → `no_account_available`.
Retrospect: ao `window_reset` semanal, grava `weekly_peak_pct`; `hit_100_weekly = peak ≥ 99` [DEC].
| Estado do widget | Evento | Novo |
|---|---|---|
| unauthenticated | login ok + Ultra | active |
| unauthenticated | login ok sem Ultra | blocked (CTA upgrade) |
| active | entitlement expira/inválido | blocked |
| active | provider falha | active + conta `unavailable` |
Casos-limite: conta sem credencial local → `auth_error` sem quebrar as demais; janela sem dados (Cursor mensal) → só `monthly`.

## 8. Prompts e textos embutidos
Sem prompts de IA embutidos [OBS]. Textos observados: "Quais são os meus limites das minhas [contas]?" (teste MCP, dia 73) [OBS]. Prompt do ARR (arquivo 08, dia ~81) [OBS]:
```
Faz a criação de Widget in Swift para colocar na minha barra superior com o valor de ARR atual. Ele fica [...] e aí coloca um [indicador] para cima ou para baixo baseado no último check que ele fez. Utiliza como base os tools do Stripe admin para conseguir ter esse número real em tempo real sendo atualizado lá em cima.
```
Instrução de uso do MCP para agentes [DEC]: "Before opening a pane, call headline_pick for the target provider and use the returned account."

## 9. Requisitos não-funcionais
- Local-first: nenhuma credencial sai da máquina [OBS: dia 54].
- Desempenho: amostragem leve; popover abre <300 ms [DEC].
- Portabilidade: Mac (Swift original), Windows (build 3.18 estabilizada no dia 72, Windows x64 e ARM), Linux; falso positivo do Defender por ler arquivos de token ("Headline Stealer"), comum em binários Go novos; mitigar com ajustes e assinatura [OBS]. Windows: crash ao abrir browser (dia 54), barra (dia 57).
- Custo: ~R$500/mês só de builds no GitHub (dia 72) [OBS].
- Segurança: leitura somente de credenciais/uso; ARR exige chave Stripe restrita read-only [DEC].
- Observabilidade: log de eventos 6b.

## 10. Stack sugerida e restrições
Original [OBS]: Swift (menu bar Mac), padrão Tauri/Rust (ambíguo), Go (binários novos), MCP, GitHub Actions/Releases, UTM, Stripe admin tools; agentes construtores: Grok 4.6, Opus, GPT. Alternativas [DEC]: núcleo Rust + Tauri (tray) e servidor MCP no mesmo binário; adaptadores por Provider isolados para trocar de método de leitura. Restrição: repositórios de código e releases separados; sem login próprio [OBS].

## 11. Plano de implementação
1. MVP: adaptadores Claude e Codex, cálculo de janelas, popover macOS.
2. Demais Providers (Antigravity, Kimi, Cursor, Groq) e multi-conta.
3. Login via sessão Overclock + Entitlement Ultra.
4. MCP `headline_limits`/`headline_pick` + registro no ADE.
5. Retrospect.
6. Builds Windows/Linux, assinatura, auto-update.
7. Fase 2: embutir no ADE, notificações, `headline_switch_account`; Overclock ARR.

## 12. Casos de teste de aceitação
1. Dado 2 contas Claude com 88% e 68% na janela semanal, então ambas listadas com % e tempo até reset.
2. Dado Codex com five_hour 99% e weekly 40%, então `bottleneck=five_hour`, `slack_pct=1`.
3. Dadas 3 contas com folgas 5/30/12, quando `headline_pick(window=auto)`, então retorna a de 30.
4. Dado nenhuma conta ok, então `no_account_available`.
5. Dado usuário sem Ultra logado, então widget bloqueado com CTA upgrade.
6. Dado credencial expirada de um Provider, então só aquela conta em `auth_error`, as outras seguem.
7. Dado reset semanal, então nova linha em Retrospect com `hit_100_weekly` correto.
8. Dado MCP fora do ar na sessão, então o widget o religa e a chamada seguinte funciona.
9. Dado Windows com Defender, então o binário assinado não é sinalizado (verificação manual).
10. Dado ARR com Stripe rate limited, então mantém último valor e aplica backoff, sem crash.

## 13. Questões em aberto e riscos
- **Q-09.1 [LAC]** Disponibilidade por SO conflitante (dias 54/55/56/58); [DEC] alvo final os três.
- **Q-09.2 [LAC]** Como ler uso de cada Provider (APIs/CLIs/arquivos); só inferido.
- **Q-09.3 [LAC]** Formato/cálculo exato do Retrospect.
- **Q-09.4 [LAC]** Schemas reais do MCP e nome exato das tools ("headline pick").
- **Q-09.5 [LAC]** Resultado final do Overclock ARR e moeda/definição de ARR.
- **Q-09.6 [LAC]** Versões (0.9, 3.18) vs app 1.3.x; Redline vs Headline.
- Riscos: mudança nos formatos de credencial/uso dos Providers; Termos de uso ao ler credenciais; falso positivo antivírus.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-09.01–04 | 09 Comportamento/Funcionamento, dias 54, 70 |
| RF-09.05–06 | 09 Retrospecto, dias 54–56, 60 |
| RF-09.07 | 09 Visão geral/Funcionamento, dias 56, 70 |
| RF-09.08–09, 09.12 | 09 MCP, dias 70, 73 |
| RF-09.10–11 | 09 Funcionamento/Windows, dias 54, 58, 72 |
| RF-09.13 | 09 Embutido, dia 75 |
| RF-09.14–15 | 09 ARR, dia 58, arquivo 08 |
