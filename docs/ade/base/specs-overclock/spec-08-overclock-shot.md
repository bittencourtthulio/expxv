---
spec: "Overclock Shot — captura de tela para agentes no terminal"
slug: "spec-08-overclock-shot"
modulo_fonte: ["08-overclock-shot"]
status_origem: construido
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces"]
---
# Spec 08 — Overclock Shot

## 1. Resumo e objetivo
Overclock Shot é um app satélite de barra de menu que captura região da tela, salva o arquivo de forma persistente (pasta Pictures), abre um editor imediato com anotações e coloca no clipboard o caminho do arquivo editado, para ser colado no prompt de um agente em um Pane. Também grava um trecho de tela e o converte em sequência de frames com FPS escolhido, poupando tokens de vídeo. Problemas resolvidos [OBS: 08 Objetivo]: (1) print nativo do Mac vai para arquivo temporário que expira (~30 s) e some de filas longas de prompts; (2) editar e depois achar/arrastar o arquivo é lento; (3) prints nativos pesam ~1 MB (Shot ~100–800 KB); (4) vídeo a ~30 fps queima tokens.

## 2. Escopo e não-escopo
**Dentro:** captura de região com mira, salvamento, editor, copiar caminho, gravação + extração de frames ("moves"), atalhos, login por sessão Overclock, checagem de Entitlement Ultra, auto-update, macOS.
**Fora:** transcrição de vídeo/análise por IA; arrastar/soltar dentro do Pane ([[spec-01-terminais-paineis-workspaces]]); billing ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); notarização ([[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança)).
**Fase 2:** Windows/Linux (promessa condicionada à demanda no dia 55; portabilidade em execução no dia 73; release não confirmada) [OBS: 08].

## 3. Glossário e atores
Usuário; agente de IA (consome o caminho do arquivo); sistema (app Shot). **Mira**: overlay com crosshair mostrando posição do pixel (apelido "headshot"). **Moves**: gravação convertida em frames. Variantes de nome ("Overshot", "clock short") são o mesmo produto [OBS: 08 Incertezas].

## 4. Requisitos funcionais
- **RF-08.01** DEVE capturar região da tela via atalho, com overlay de mira exibindo posição do pixel. [OBS: 08 Comportamento, dia 56] Aceite: arrastar região gera PNG apenas dessa área.
- **RF-08.02** DEVE salvar a captura imediatamente em `~/Pictures/Overclock Shot/` (nunca em temp). [OBS: dia 55] Aceite: arquivo existe após 5 min.
- **RF-08.03** DEVERIA produzir arquivos de ~100–800 KB para capturas típicas. [OBS: 08] [DEC] PNG otimizado ou WebP/JPEG q≥85 se >800 KB; formato final: [LAC].
- **RF-08.04** DEVE abrir a galeria/editor imediatamente após capturar, com setas, caneta vermelha e anotações. [OBS: dia 55]
- **RF-08.05** DEVE salvar automaticamente edições (original observado: ~10 s) sobre o mesmo arquivo ou irmão. [OBS: dia 55; DEC: salvar também ao clicar Copiar e ao fechar]
- **RF-08.06** DEVE ter botão "copiar" que salva pendências e coloca no clipboard o caminho absoluto do arquivo editado (texto) para colar no prompt. [OBS: dia 55] Aceite: Cmd+V em um Pane insere o caminho.
- **RF-08.07** DEVERIA também permitir arrastar a miniatura para um Pane, colando o caminho. [OBS: 08 Comportamento]
- **RF-08.08** DEVE gravar um trecho de tela por atalho, e, ao parar, apresentar seletor de FPS (ex.: 1, 2, 10) e gerar frames em `Pictures/Overclock Shot/moves/<timestamp>/`. [OBS: dias 55, 56, 60] Aceite: 5 s a 2 fps gera 10 imagens.
- **RF-08.09** DEVE copiar o caminho da pasta de frames (ou lista) ao clipboard após conversão. [DEC: extensão coerente com RF-08.06]
- **RF-08.10** DEVE permitir usar atalhos próprios ou os nativos do macOS, sem manter ambos ativos simultaneamente e restaurando os nativos ao desativar. [OBS: bug dia 55 corrigido]
- **RF-08.11** DEVE autenticar via sessão do app Overclock ("Entrar pelo Overclock app") sem cadastro próprio. [OBS: dia 56]
- **RF-08.12** DEVE liberar o uso mediante Entitlement (Plan Ultra) obtido do backend. [OBS: 08 Negócio; conflito "90 dias grátis" → Q-08.2]
- **RF-08.13** DEVE solicitar permissões de gravação de tela e guiar o usuário quando negadas. [DEC: exigência do macOS; observado indiretamente nos bugs dias 56/60]
- **RF-08.14** DEVE checar atualização e atualizar via GitHub Releases. [OBS: 08 Funcionamento]
- **RF-08.15** DEVERIA ter tela de configurações (atalhos, pasta, FPS padrão, modo de atalho), acessível sem falhas. [OBS: bug dia 56 "configurações não abrem"]

## 5. Modelo de dados
```json
// Settings
{ "capture_hotkey":"Cmd+Shift+4", "record_hotkey":"Cmd+Shift+6", "use_native_hotkeys":false,
  "output_dir":"~/Pictures/Overclock Shot", "default_fps":2, "autosave_interval_s":10,
  "copy_format":"path", "auto_update":true }
// Capture
{ "id":"uuid","kind":"image|moves","path":"/Users/x/Pictures/Overclock Shot/2026-01-01_12-00-00.png",
  "created_at":"...","size_bytes":420000,"annotated":true,"fps":null,"frame_count":null }
// EntitlementCache { "plan":"ultra|other","checked_at":"...","expires_at":"..." }
```
Invariantes: `path` sempre sob `output_dir`; moves em `output_dir/moves/`; `frame_count = ceil(duração_s × fps)` [DEC]. Ciclo de vida: arquivos são do usuário e nunca apagados pelo app [DEC]; anotações destrutivas no arquivo editado (original preservado como `*.orig.png` [DEC]).

## 6. Interfaces
**(a) UI:** ícone de barra com menu (Capturar, Gravar, Abrir galeria, Configurações, Sair); overlay de mira em tela cheia com região e readout de pixel; janela de galeria/editor com barra de ferramentas (seta, caneta vermelha, texto, desfazer) e botão **Copiar**; diálogo pós-gravação com seletor de FPS. Login: botão "Entrar pelo Overclock app".
Atalhos [OBS parcialmente]: captura (dia 61 cita Cmd+4 na demo) [LAC]; gravação: Cmd+Shift+5 (dia 55) / Cmd+Shift+6 (dias 56, 57, 60). [DEC] defaults: captura Ctrl+Shift+4 (evita colisão com Cmd+Shift+4 nativo); gravação Cmd+Shift+6 (não colide com nativo).
**(b) Eventos:** `capture_started`, `capture_saved{path,size_bytes}`, `edit_autosaved{path}`, `path_copied{path}`, `recording_started`, `recording_stopped{duration_s}`, `frames_extracted{dir,fps,frame_count}`, `entitlement_denied`.
**(c) MCP:** nenhuma [OBS]. [DEC] não expor.
**(d) Externo:** backend Overclock (sessão/Entitlement); GitHub Releases; nenhum protocolo com o Pane — integração via clipboard/caminho [OBS].

## 7. Fluxos e algoritmos
Captura: hotkey → checa Entitlement → overlay → seleção → captura → grava em output_dir → abre editor → autosave a cada N s → Copiar → path no clipboard.
Gravação: hotkey record → grava (ScreenCaptureKit ou equivalente [DEC]) → hotkey/parar → diálogo FPS → extrai frames (`ffmpeg -vf fps=N` ou API nativa [DEC]) → salva em `moves/<ts>/frame_%04d.png` → copia caminho.
Estados de atalho: `nativos ↔ próprios` exclusivo; ao ativar próprios, registra hotkeys globais e libera os nativos ao desligar (RF-08.10).
| Estado | Evento | Novo |
|---|---|---|
| idle | capture_hotkey | selecting |
| selecting | esc | idle |
| selecting | region_confirmed | editing |
| editing | copy | idle (path no clipboard) |
| idle | record_hotkey | recording |
| recording | stop | fps_dialog |
| fps_dialog | confirm | extracting → idle |
| qualquer | entitlement inválido | blocked |
Erros: disco cheio/permissão de pasta → alerta; região <5×5 px → cancela [DEC]; permissão de tela negada → guia.

## 8. Prompts e textos embutidos
O produto não embute prompts de IA. O material não registra prompt de construção do Shot (criado fora de câmera, dias 54–55) [OBS: 08]. Textos de UI: "Entrar pelo Overclock app", "Copiar" [OBS]; demais [DEC]. Prompt-base sugerido para agente que consome frames [DEC]: "The folder <path> contains N frames sampled at F fps from a screen recording. Describe the sequence of events and identify the bug."

## 9. Requisitos não-funcionais
- Latência: captura→arquivo salvo <500 ms; editor abre <1 s [DEC; original sem número].
- Tamanho: 100–800 KB por print [OBS].
- Portabilidade: macOS no lançamento; Windows/Linux fase 2 (build provada em UTM; release não confirmada) [OBS].
- Segurança: capturas ficam locais; sem upload [DEC]; permissão de gravação de tela mínima.
- Custo/tokens: frames a 1–2 fps em vez de ~30 fps [OBS].
- Observabilidade: log local dos eventos 6b [DEC].

## 10. Stack sugerida e restrições
Original [OBS]: Swift (Mac), depois padrão comum dos widgets (Tauri/Rust, ambíguo), captura/gravação nativas macOS, GitHub Releases, notarização; migração exigida "sem regressão". Alternativas [DEC]: Tauri + plugin nativo (ScreenCaptureKit/`scap`), ffmpeg embutido para frames, canvas para editor. Restrição: repositórios de código e releases separados [OBS].

## 11. Plano de implementação
1. MVP: hotkey, mira, salvar em Pictures, copiar caminho.
2. Editor com setas/caneta + autosave.
3. Gravação + extração de frames com seletor de FPS.
4. Login via sessão Overclock + Entitlement + auto-update + notarização.
5. Modo de atalhos (próprios/nativos) e configurações.
6. Fase 2: Windows/Linux.

## 12. Casos de teste de aceitação
1. Dado hotkey de captura, quando seleciono região, então PNG existe em `~/Pictures/Overclock Shot/` com só a região.
2. Dado captura feita há 5 min, então o arquivo continua existindo.
3. Dado editor aberto, quando desenho seta e clico Copiar, então o clipboard contém o caminho e o arquivo contém a seta.
4. Dado gravação de 5 s e FPS 2, então `moves/<ts>/` tem 10 frames.
5. Dado gravação e FPS 1, então frames = duração em s.
6. Dado ESC durante seleção, então nada é salvo.
7. Dado usuário sem Plan Ultra (e sem janela promocional), então captura é bloqueada com CTA de upgrade/login.
8. Dado atalhos próprios ativos e depois desativados, então os nativos do macOS voltam a funcionar e nunca disparam ambos ao mesmo tempo.
9. Dado permissão de tela negada, então diálogo de orientação, sem crash.
10. Dado disco sem permissão de escrita em output_dir, então erro claro.

## 13. Questões em aberto e riscos
- **Q-08.1 [LAC]** Atalhos finais (Cmd+4, Cmd+Shift+5/6).
- **Q-08.2 [LAC]** "90 dias grátis" (dia 61) vs "gratuito para Ultra": Entitlement via backend, sem regra hardcoded [DEC].
- **Q-08.3 [LAC]** Formato de arquivo, formato do "link" copiado (caminho absoluto assumido).
- **Q-08.4 [LAC]** Windows/Linux: existência de release.
- **Q-08.5 [LAC]** Escolha exata Swift vs Tauri para o produto final.
- Riscos: regressões na migração de stack (dia 56); overlay invisível (dia 63, ambíguo); conflito com atalhos nativos.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-08.01 | 08 Visão geral/Mira, dia 56 |
| RF-08.02–03 | 08 Objetivo, dia 55 |
| RF-08.04–07 | 08 Comportamento/Features, dia 55 |
| RF-08.08–09 | 08 Gravação por frames, dias 55, 56, 60 |
| RF-08.10 | 08 Funcionamento (bug dia 55) |
| RF-08.11–12 | 08 Login/Negócio, dia 56 |
| RF-08.13–15 | 08 Bugs dias 56/60; Funcionamento |
