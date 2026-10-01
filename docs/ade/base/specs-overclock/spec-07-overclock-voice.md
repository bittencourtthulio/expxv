---
spec: "Overclock Voice — ditado por voz com tradução PT→EN"
slug: "spec-07-overclock-voice"
modulo_fonte: ["07-overclock-voice"]
status_origem: construido
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-04-providers-e-modelos"]
---
# Spec 07 — Overclock Voice

## 1. Resumo e objetivo
Overclock Voice é um app satélite de barra de menu/bandeja que captura a fala do usuário enquanto uma tecla é mantida (ou alternada), transcreve via STT (Groq/Whisper na nuvem com chave do usuário, ou Whisper local), opcionalmente refina/traduz o texto com um LLM e injeta o resultado no campo em foco de qualquer aplicativo (inclusive um Pane do Overclock). Problemas resolvidos: (1) digitar prompts é lento (~70 ppm digitando vs ~200 ppm falando) [OBS: 07, dia 57/58]; (2) prompts em português consomem mais tokens de entrada que o equivalente em inglês (~23% de redução média medida) [OBS: 07, dia 58]. Filosofia: "todo plano e código em inglês para economizar tokens" [OBS: 07, dia 57].

## 2. Escopo e não-escopo
**Dentro:** captura de áudio, STT nuvem/local, modos Chat/Code/Legal, injeção de texto, atalho configurável, histórico, dicionário, perfis, idioma, medidor de ppm, teste de digitação no onboarding, login via sessão Overclock, checagem de Entitlement, auto-update, builds macOS/Windows/Linux.
**Fora:** o app Overclock ADE em si ([[spec-01-terminais-paineis-workspaces]]); billing/planos ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); pipeline de assinatura/notarização ([[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança)); TTS (citado no dia 61, sem detalhe) e "Jarvis" por voz ([[spec-11-jarvis-open-jarvis]]) — fase 2 [OBS: 07, dia 61].
**Fase 2 (planejado/parcial no original):** modo local completo (STT + Qwen local; no original ainda "em otimização, com bugs") [OBS: 07, dia 73]; modo Legal.

## 3. Glossário e atores
- **Usuário**: fala e recebe texto. **Sistema**: app Voice. **Provedor STT/LLM**: Groq (Provider; ver [[spec-04-providers-e-modelos]]). **Overclock ADE**: hospeda sessão de login e, opcionalmente, o microfone interno.
- **Modo Chat**: transcrição fiel no idioma falado. **Modo Code**: transcrição + tradução/limpeza para inglês técnico. **Modo Legal ("Leigo")**: reescrita em linguagem simples, sem jargão. **Dictionary**: vocabulário customizado. **Profile**: estilo de refinamento editável.
- Nomes "Clock Voice"/"Overclock Voice" designam o mesmo produto (embutido → satélite) [OBS: 07].

## 4. Requisitos funcionais
- **RF-07.01** DEVE gravar áudio do microfone enquanto a tecla de ditado estiver pressionada (hold) e finalizar ao soltar. [OBS: 07 Comportamento] Aceite: soltar a tecla dispara STT em <200 ms.
- **RF-07.02** DEVERIA suportar também modo toggle (aperta inicia, aperta para). [LAC: dia 75 relata toggle desligando após 2 s e recomenda só "apertar"; ver Q-07.1] [DEC] Default: hold como padrão; toggle opcional com debounce de 300 ms.
- **RF-07.03** DEVE ter um único atalho de ditado, configurável pelo usuário, com um teste de tecla que valide a captura real antes de salvar. [OBS: 07, dia 58 (bug: teste não validava)] Aceite: tecla inválida/não capturável mostra erro e não é salva.
- **RF-07.04** DEVE expor o modo ativo (Chat/Code/Legal) na barra e permitir alternar por botão fixo na janela/menu. [OBS: 07, dia 57]
- **RF-07.05** DEVE, no modo Chat, fazer uma única chamada STT sem tradução usando `whisper-large-v3-turbo`. [OBS: 07 Funcionamento]
- **RF-07.06** DEVE, no modo Code, fazer STT com `whisper-large-v3` (turbo não traduz) e em série refinar por LLM: traduzir para inglês, remover muletas/repetições, preservar 100% da intenção e nomes técnicos. [OBS: 07 Funcionamento] Aceite: "Cria um endpoint que salva o arquivo config.json..." mantém `config.json`, `migrate`, `Supabase` literais.
- **RF-07.07** DEVE, no modo Legal, reescrever fala técnica em linguagem simples (leitor de ~12 anos, "seja claro, não seja inteligente"). [OBS: 07, dia 73] Status: parcial.
- **RF-07.08** DEVE injetar o texto final somente ao término do pipeline no campo em foco; ESC cancela em qualquer etapa sem injetar nada. [OBS: 07]
- **RF-07.09** DEVE evitar duplicação de texto ao colar e garantir espaços entre injeções consecutivas. [OBS: 07, dias 57/75 (bugs)] Aceite: duas falas seguidas produzem "A B", sem repetição.
- **RF-07.10** DEVE manter buffer do texto/áudio em falha e tentar uma vez novamente; erros distintos: sem internet, chave recusada, limite do tier gratuito. [OBS: 07]
- **RF-07.11** DEVE manter histórico de frases ditadas (consultável e copiável). [OBS: 07] [LAC] retenção/limite: [DEC] 500 entradas, local, exclusão manual.
- **RF-07.12** DEVE oferecer Dictionary (termos técnicos/nomes) enviado como `prompt` ao STT e como glossário ao LLM. [OBS: 07 (existência); DEC: mecanismo de uso]
- **RF-07.13** DEVE permitir escolher idioma de fala (pt/en) e evitar detecção errada (bug: caracteres russos). [OBS: 07, dia 57] [DEC] passar `language` explícito ao Whisper.
- **RF-07.14** DEVERIA exibir ppm (palavras/minuto) da última fala e um teste de digitação no onboarding. [OBS: 07]
- **RF-07.15** DEVE exigir login antes do uso, reutilizando a sessão do Overclock ADE (sem cadastro próprio) e resolver Entitlement (Pro/Ultra: incluso sem trial; demais: trial de 30 dias contado da primeira fala). [OBS: 07 Login; regras de preço variam, ver Q-07.3]
- **RF-07.16** DEVE permitir configurar chave Groq do usuário (armazenada no cofre do SO). [OBS: 07 onboarding; DEC: cofre do SO]
- **RF-07.17** DEVE oferecer seleção de motor: nuvem (Groq) ou local (Whisper local; LLM local Qwen para Code/Legal). [OBS: 07, dia 73] Fase 2.
- **RF-07.18** DEVE mostrar ícone animado durante gravação e voltar a "parado" ao final. [OBS: 07]
- **RF-07.19** DEVE mostrar versão instalada e botão "verificar atualização"; auto-update via GitHub Releases. [OBS: 07, dias 58]
- **RF-07.20** DEVE permitir ao Overclock ADE ligar/mutar/desligar o microfone interno e ocultar o widget quando desligado. [OBS: 07, dia 55 (1.3.3)]
- **RF-07.21** DEVERIA compatibilizar com teclas espaço, F8, Fn, Option (citadas) [OBS: 07]; [DEC] default no macOS: Option direita; Windows/Linux: F8 (evitar espaço global por colidir com digitação).

## 5. Modelo de dados
Persistência local (JSON em app-data do SO; segredos no keychain).
```json
// Settings
{ "hotkey": {"key":"AltRight","mode":"hold"}, "active_mode":"code", "language":"pt",
  "engine":"cloud", "groq_key_ref":"keychain:overclock-voice/groq",
  "stt_models":{"chat":"whisper-large-v3-turbo","code":"whisper-large-v3"},
  "llm_model":"<groq-llm-id>", "active_profile_id":"default", "mic_device_id":null,
  "typing_test_wpm":null, "auto_update":true }
// HistoryEntry
{ "id":"uuid","ts":"2026-01-01T12:00:00Z","mode":"code","raw_text":"...","final_text":"...",
  "duration_ms":4200,"wpm":190,"target_app":"Terminal","status":"injected|cancelled|failed","error":null }
// DictionaryTerm  { "term":"Supabase", "hint":"marca; não traduzir" }
// Profile  { "id":"default","name":"Preciso","mode":"code","system_prompt":"...","temperature":0.2 }
// EntitlementCache { "plan":"ultra|pro|boost|none","trial_started_at":null,"checked_at":"...","expires_at":"..." }
```
Invariantes: `groq_key_ref` obrigatório quando `engine=cloud`; `final_text` só existe se `status=injected`; `EntitlementCache` expira em ≤24 h [DEC]. Ciclo de vida: histórico local; áudio bruto NÃO persistido após transcrição [DEC privacidade].

## 6. Interfaces
**(a) UI:** ícone de barra (estados: idle, recording com animação de raios, processing, error); janela de preferências com menu lateral (Geral, Atalho, Microfone, Idioma, Modo/Perfis, Dicionário, Histórico, Conta); botão de modo fixo no canto superior direito; onboarding em 6 passos (login por código → chave Groq gratuita sem cartão → atalho → microfone → idioma → dicionário + teste de digitação) [OBS: 07]. Sem janela principal [OBS: 07, dia 57].
**(b) Eventos internos** (snake_case): `dictation_started{mode}`, `audio_captured{duration_ms}`, `stt_done{text,model,latency_ms}`, `refine_done{text,latency_ms}`, `text_injected{chars,target_app}`, `dictation_cancelled{stage}`, `dictation_failed{stage,code}`. Códigos: `no_network`, `key_rejected`, `rate_limited`, `mic_denied`, `accessibility_denied`, `no_entitlement`.
**(c) MCP:** nenhuma tool no original [OBS: 07]. [DEC] não expor.
**(d) Protocolos externos:** Groq `POST /openai/v1/audio/transcriptions` (Chat/Code STT) e `POST /openai/v1/chat/completions` (refino) [DEC: endpoints compatíveis OpenAI, coerentes com "API compatível" do dia 56]; backend Overclock para sessão/Entitlement; GitHub Releases (`overclock-voice-releases`) [OBS: 07]. Integração com Pane: [DEC] o Voice injeta por colagem/teclas sintéticas no app em foco; sem IPC dedicado ([[spec-01-terminais-paineis-workspaces]] não precisa mudar).

## 7. Fluxos e algoritmos
Pipeline (uma fala):
1. Tecla down → checa Entitlement e permissão de mic → `dictation_started`.
2. Captura PCM 16 kHz mono; ESC → cancelar.
3. Tecla up → encerra; se duração <300 ms [DEC] descarta.
4. STT: modo chat → turbo; code/legal → large-v3; `language` fixo; `prompt`=dicionário.
5. Se modo ∈ {code, legal}: LLM com system prompt do Profile (seção 8), temperatura baixa.
6. Injeta (salvar clipboard → colar → restaurar clipboard [DEC]; fallback teclas sintéticas).
7. Grava HistoryEntry, atualiza ppm.
Erro: qualquer etapa falha → mantém buffer, 1 retry após 1 s, então erro classificado e notificação.

Máquina de estados:
| Estado | Evento | Novo estado |
|---|---|---|
| idle | hotkey_down (autorizado) | recording |
| idle | hotkey_down (sem entitlement) | idle + aviso `no_entitlement` |
| recording | hotkey_up | transcribing |
| recording | esc | idle |
| transcribing | stt_ok, modo chat | injecting |
| transcribing | stt_ok, modo code/legal | refining |
| transcribing/refining | esc | idle |
| refining | llm_ok | injecting |
| refining | llm_fail (após retry) | injecting com texto STT bruto + aviso [DEC] |
| injecting | ok | idle |
| qualquer | erro_stt (após retry) | error → idle após 3 s |
Casos-limite: fala vazia → não injeta; sem foco de campo → copia ao clipboard e notifica; rate limit → mensagem específica.

## 8. Prompts e textos embutidos
O original não registra o prompt de sistema do refino [LAC]; só o requisito (traduzir, limpar muletas e repetições, preservar intenção e nomes técnicos; variante "densa/imperativa" rejeitada) [OBS: 07]. Prompt-base [DEC]:
```
You are a dictation post-processor. Input: a transcript in Portuguese (may contain filler words, repetitions, self-corrections).
Task: output the same request in clear technical English. Rules:
- Preserve 100% of the user's intent; do not add, drop or reinterpret requirements.
- Remove filler words, stutters and repetitions.
- Keep code identifiers, file names, commands, product names and the terms in <dictionary> exactly as-is.
- Output only the final text, no quotes, no commentary.
<dictionary>{terms}</dictionary>
```
Modo Legal [DEC], baseado no lema observado:
```
Rewrite the text in the same language as the input, in plain words a 12-year-old would understand. No jargon. Keep meaning. Be clear, not clever. Output only the rewritten text.
```
Exemplo de validação Legal [OBS: dia 73]: "gestão de entregabilidade para clientes de tráfego próprio de e-mail marketing" → "controlar a entrega das minhas mensagens de e-mail para os clientes que eu mesmo atraio".
Textos de venda observados: "codar até 3x mais rápido e economizar até 33% (ou 23%) de tokens de entrada" [OBS: dia 58]; usar somente a versão mensurável (~23%) [DEC].

## 9. Requisitos não-funcionais
- Latência: Chat = 1 chamada rápida; Code = 2 chamadas (mais lento) [OBS]; STT local ~10 s observado, motivo da nuvem [OBS]. [DEC] meta nuvem: p50 ≤2 s Chat, ≤4 s Code para falas de 10 s.
- Portabilidade: macOS (Swift ou casca nativa), Windows (instalador sem assinatura → SmartScreen; assinatura custaria ~R$300/mês, sem solução), Linux [OBS: dia 58]. Windows x64 real não confirmado no dia 58, resolvido no dia 73 [OBS]. Linux: atraso de digitação (dia 75).
- Permissões: microfone e acessibilidade/input monitoring (macOS) [OBS: bugs dia 57].
- Segurança/privacidade: chave Groq no cofre do SO; áudio enviado a terceiro (Groq) — informar no onboarding [DEC]; logs sem conteúdo de fala [DEC].
- Custo: STT do Clock Voice embutido custou ~R$300 no dia 32 [OBS]; no satélite custo é do usuário (chave própria).
- Observabilidade: eventos da seção 6b em log local rotativo [DEC].

## 10. Stack sugerida e restrições
Original [OBS]: Groq Whisper large-v3 / turbo, Whisper local, Apple Speech, Rust+Tauri e/ou Swift, Qwen local, Supabase (login), Stripe, GitHub Releases + auto-update, notarização Apple, UTM para Windows. Alternativas [DEC]: núcleo Rust (captura `cpal`, hotkeys, injeção `enigo`/APIs nativas) + UI Tauri; whisper.cpp para local; qualquer provedor OpenAI-compatível. Restrição: repositório de código privado + repositório público de releases [OBS].

## 11. Plano de implementação
1. MVP macOS: hold-to-talk, Groq turbo (Chat), injeção, ESC, ícone, chave Groq. 
2. Modo Code (large-v3 + LLM), dicionário, idioma, erros/retry, histórico.
3. Login via sessão Overclock + Entitlement + trial; preferências; onboarding; ppm/teste de digitação.
4. Auto-update, notarização, página de download no dashboard.
5. Windows e Linux (build em VM, teste em x64 real).
6. Fase 2: local (Whisper + Qwen), modo Legal completo, integração ligar/mutar pelo ADE.

## 12. Casos de teste de aceitação
1. Dado Chat e chave válida, quando seguro a tecla e falo "olá mundo", então "olá mundo" é digitado no campo em foco uma única vez.
2. Dado Code, quando falo o exemplo do config.json/Supabase, então saída é inglês e mantém `config.json` e `Supabase`.
3. Dado gravação em andamento, quando aperto ESC, então nada é injetado e o estado volta a idle.
4. Dado sem internet, quando solto a tecla, então 1 retry e erro `no_network` distinto; texto não perdido no buffer.
5. Dado chave recusada (401), então erro `key_rejected`; dado 429, então `rate_limited`.
6. Dado usuário Pro/Ultra, então nenhum aviso de trial; dado usuário sem plano após 30 dias da primeira fala, então `no_entitlement`.
7. Dado duas falas seguidas, então texto sem duplicação e com espaço entre elas.
8. Dado atalho inválido no teste de tecla, então não é salvo.
9. Dado LLM indisponível no modo Code, então injeta transcrição bruta com aviso.
10. Dado mic negado, então guia para permissão; nada travado.
11. Dado microfone interno desligado no ADE, então widget some e não captura.

## 13. Questões em aberto e riscos
- **Q-07.1 [LAC]** Toggle vs hold: material indica bug no toggle; decisão do dono (default DEC = hold).
- **Q-07.2 [LAC]** Nome do modelo LLM de refino (Groq/Grok/Qwen; transcrição ruidosa) e de "Qwen 3.8".
- **Q-07.3 [LAC]** Regras de gratuidade conflitantes (5/out, 3/set, 5/nov/2026; 30 likes... 500 likes) — implementar Entitlement via backend, sem datas hardcoded [DEC].
- **Q-07.4 [LAC]** Atalho final (espaço, F8, Fn, Option).
- **Q-07.5 [LAC]** Estado final do Linux; "Legal" vs "Leigo" (nome do modo).
- **Q-07.6 [LAC]** Prompt de refino real (a spec usa prompt-base DEC).
- Riscos: injeção em apps protegidos/Wayland; PII enviada ao Groq; fraude em metas de likes; Windows sem assinatura.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-07.01–03 | 07 Comportamento; dias 57/58/75 |
| RF-07.04–07 | 07 Funcionamento; dias 57, 73 |
| RF-07.08–10 | 07 Comportamento/Funcionamento |
| RF-07.11–14 | 07 Comportamento; dia 57 |
| RF-07.15–16 | 07 Login/Onboarding; dias 56, 58 |
| RF-07.17 | 07 dia 73 |
| RF-07.18–21 | 07 Comportamento; dias 55, 58 |
