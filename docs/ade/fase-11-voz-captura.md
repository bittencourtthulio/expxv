# Fase 11 — Voz e captura (ditado no terminal + captura de tela anexada ao Pane)

Valor para o dev: **falar o prompt em vez de digitar** (≈ 200 palavras por minuto falando contra ≈ 70 digitando) e **mostrar o bug em vez
de descrevê-lo** (captura de região anotada, ou sequência de quadros, entregue ao agente como caminho de arquivo no próprio Pane). As
duas funções são pequenas, vivem dentro do ExpxV e têm o terminal do app como destino: **nada de clipboard, nada de Acessibilidade,
nada de teclas sintéticas** (isso elimina ≈ 80% dos riscos das specs 07 e 08). Base: `base/D-ecossistema.md` (specs 07 e 08, com a
recomendação de recorte), `base/specs-overclock/spec-07-overclock-voice.md`, `spec-08-overclock-shot.md`, `05-CONTRATOS.md`,
`04-UI-UX.md` (D-32), ExpxMedia (somente leitura: `desktop/src/ditado/gerenciador.ts`).

## Portão da fase

1. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos incluindo P-47).
2. E2E no Electron real, **sem microfone nem tela reais**: microfone falso do Chromium
   (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, ligados só pela variável de ambiente de teste derivada de
   `PRODUTO.prefixoEnv` e **ignorada em app empacotado**), motor de STT = CLI falsa (`tests/fixtures/stt-falso.mjs`), terminal = CLI
   falsa de eco. Cenários: ditado completo (segurar → soltar → texto no Pane, sem Enter), ESC cancela, alternar, motor ausente,
   permissão negada, captura da janela do app, captura de tela por fonte falsa (imagem gerada, fator de escala 2), quadros 2 fps.
3. `npm run perf`: P-40 a P-49 verdes e P-01/P-08 sem piorar; `ultimo.json` gravado.
4. Auditoria de privacidade (T-11.22) verde: **zero conexão de rede** sem consentimento registrado, **áudio nunca em disco** (exceto o WAV
   temporário 0700 do motor local, apagado em `finally`), logs sem conteúdo de fala, mic fechado fora da fala, overlays sempre destruídos.
5. `npm run test:pacote` confere no pacote: `NSMicrophoneUsageDescription`, entitlement `com.apple.security.device.audio-input` e o
   worklet de áudio presentes.
6. Checklist manual registrado em `STATUS.md` (o que só uma pessoa vê): microfone real no macOS (dialogo do SO só no 1º uso), captura
   multi-monitor com um monitor Retina, atalho segurado dentro e fora do foco do terminal.

## Princípios

1. **Privacidade antes de conveniência.** Áudio e captura **nunca saem da máquina** sem consentimento explícito, por serviço e por host,
   e **todo serviço remoto nasce DESLIGADO** (D-64). Sem motor de voz configurado, o ditado simplesmente não existe: nenhum download,
   nenhuma instalação, nenhum "tentar a nuvem" por padrão. Telemetria: nenhuma (D-25).
2. **Segredos nunca em log, argv, evento, banco ou JSON.** Chaves ficam no `safeStorage` do Electron (T-11.02); o renderer só descobre
   "tem chave: sim/não". Erro cita o **nome** do segredo, nunca o valor. Texto de fala não vai para log (só contagens e códigos).
3. **Permissões do SO só no primeiro uso, com explicação.** Nada é pedido no boot nem ao abrir a tela. Antes do diálogo do SO, o app
   mostra um diálogo próprio dizendo o que será usado, para quê, o que **não** acontece (sem upload, sem gravação em disco) e como
   desfazer. Negada: estado claro com o caminho para Ajustes do Sistema, nunca laço de pedidos.
4. **Leveza e velocidade.** Serviços de voz e captura são criados **no primeiro uso** (fora do boot, P-48); módulos em chunks lazy
   (P-47); o microfone só fica aberto **enquanto se fala** (P-49); captura e quadros nunca bloqueiam o main (P-12).
5. **O destino é o Pane, não o sistema.** A voz escreve no PTY do Pane em foco (sem Enter automático: quem submete é a pessoa); a
   captura vira caminho no prompt pelo mecanismo de anexos que já existe (T-01.08). Nenhuma injeção em outros aplicativos.
6. **Contrato primeiro, adaptador depois.** Motor de STT, fonte de tela e tecla global são portas com adaptadores trocáveis e falsos de
   teste; a lógica (máquina de estados, WAV, geometria de recorte, mapeamento de escala) é pura e testada sem Electron.
7. **Agente não captura tela nem ouve o microfone.** Não existe tool MCP de captura ou de voz (D-65): quem aciona é a pessoa.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`)

Método comum: Playwright sobre o Electron real com microfone, motor e fonte de tela falsos; `PerformanceObserver`/`longtask`;
`process.getProcessMemoryInfo`; resultado em `docs/ade/perf/ultimo.json`. `EXPXV_PERF_FATOR` vale como nos demais.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-40 | Tecla pressionada → captura de áudio ativa (indicador visível em ≤ 50 ms; 1º bloco de PCM em ≤ 300 ms, permissão já concedida) | indicador p95 ≤ 50 ms; 1º bloco p95 ≤ 300 ms | marca no `keydown`, marca no indicador e no 1º `voz:audio` no main (mic falso) |
| P-41 | Soltar a tecla → texto no terminal, **overhead do ExpxV** (fala de 10 s, motor falso instantâneo) | p95 ≤ 150 ms | marca no `keyup` e no 1º `terminais:escrever` ao PTY de eco |
| P-42 | Nenhum quadro longo durante o ditado e nível do indicador | `longtask` > 50 ms = 0; atualização do nível ≤ 20 Hz, re-render só do indicador | `longtask` + contagem de renders (React Profiler) |
| P-43 | Memória do buffer de fala | pico ≤ 4 MB (120 s de PCM16 16 kHz mono = 3,84 MB); após 50 falas, volta ao baseline ± 2 MB | `getProcessMemoryInfo` antes/depois, GC forçado no teste |
| P-44 | Atalho de captura → overlay com a imagem congelada visível; confirmar seleção → arquivo salvo | overlay p95 ≤ 250 ms (1 monitor, fator 2); salvo p95 ≤ 500 ms | marcas no atalho, no `show` do overlay e no `rename` final |
| P-45 | Pico de memória da captura (tela 5K, 59 MB por quadro BGRA) e limpeza | pico ≤ +200 MB; volta a ≤ +20 MB do baseline em ≤ 5 s; **0** janelas de overlay vivas | `getProcessMemoryInfo` + `BrowserWindow.getAllWindows()` |
| P-46 | Gravação por quadros (2 fps, 30 s) | ≥ 90% dos quadros previstos; main nunca > 50 ms (P-12); fim em ≤ 1 s após o pedido de parar | contagem de arquivos, monitor de event loop |
| P-47 | Peso no JS inicial e chunks | bundle inicial **+ ≤ 3 KB gz** (só ganchos); chunk de voz ≤ 15 KB gz; chunk do editor de anotação ≤ 30 KB gz; nenhuma dependência nova | script de tamanho no build (P-08 estendido) |
| P-48 | Custo no boot | P-01 não piora > 10 ms; **0** serviços de voz/captura criados antes do 1º uso | marca de boot + teste de que `ServicoVoz`/`ServicoCaptura` são construídos sob demanda |
| P-49 | Microfone fechado fora da fala (orçamento de privacidade) | `MediaStreamTrack` ativos = **0** fora de `gravando`; 0 após cancelar/erro/blur/fechar janela | teste de renderer com `getUserMedia` falso e e2e com o mic falso |

## Arquitetura

```
src/nucleo/privacidade/     consentimento.ts (registro por serviço+host), segredos.ts (porta; implementação no main), redacao.ts
src/nucleo/voz/
  maquina.ts                máquina de ditado pura (ocioso→gravando→transcrevendo→refinando→injetando→ocioso)
  wav.ts                    cabeçalho WAV, acumulador PCM16 (limites, fala curta, energia/RMS), sem I/O
  pos-processo.ts           dicionário, normalização, sanitização para PTY, modos fiel | ingles_tecnico
  motores/
    motor.ts                interface MotorStt {transcrever(wav, opcoes)}; erros nominais
    comando-local.ts        executável escolhido pelo usuário (sem shell, WAV temporário 0700)
    http-compativel.ts      POST /audio/transcriptions (multipart), chave do cofre, consentimento, 1 retry
    refino.ts               POST /chat/completions opcional (modo ingles_tecnico)
  teclas.ts                 porta TeclaGlobal + atalho alternar; adaptador 'nativo' = indisponivel (P-35)
src/nucleo/captura/
  geometria.ts              displays, fator de escala, recorte físico↔lógico (puro)
  imagem.ts                 PNG/JPEG ≤ 800 KB, detecção de imagem em branco (sem permissão), nome de arquivo
  armazem.ts                .expxv/capturas/, original .orig, índice, nunca apaga sozinho
  quadros.ts                amostrador (1|2 fps), limites, backpressure
src/main/
  permissoes.ts             status/pedido de microfone e tela, abrir Ajustes, handler de permissões restrito
  segredos.ts               safeStorage (arquivo 0600 com blobs cifrados); nunca devolve valor ao renderer
  voz.ts                    ServicoVoz (lazy): sessão de ditado, motor, injeção no Pane, eventos
  captura.ts                ServicoCaptura (lazy): fontes, overlay por display, quadros, anexar
  captura-overlay.ts        BrowserWindow transparente por display + preload próprio (preload-overlay.ts)
  ipc/voz.ts · ipc/captura.ts
src/renderer/voz/           capturaAudio.ts (getUserMedia + AudioWorklet), worklet-pcm.js (asset estático), usarDitado.ts
src/renderer/telas/terminais/BotaoVoz.tsx   botão e indicador na linha de controles (D-32)
src/renderer/telas/config/SecaoVoz.tsx · SecaoCaptura.tsx · SecaoPermissoes.tsx
src/renderer/telas/captura/ (lazy)          galeria compacta + editor de anotação (Canvas, sem biblioteca)
tests/fixtures/stt-falso.mjs                motor falso (texto fixo, atraso, falha, lê e apaga o WAV)
```

Fluxo do ditado (um único processo, sem etapas persistidas):

```
keydown ─► renderer abre mic (AudioWorklet, PCM16/16 kHz) ─► blocos 4–64 KiB via voz:audio ─► main acumula (em memória)
keyup   ─► renderer fecha o mic ─► main monta WAV ─► MotorStt (local | http) ─► [refino opcional] ─► pós-processo
        ─► sanitiza ─► escreve no PTY do Pane em foco (sem Enter) ─► evento voz:texto
ESC / blur / troca de Pane / janela fecha ─► cancela em qualquer etapa; nada é injetado; buffer zerado
```

Fluxo da captura de tela:

```
atalho ─► ServicoCaptura.congelar(): para cada display, desktopCapturer.getSources({types:['screen'],
          thumbnailSize: bounds × scaleFactor}) ─► overlay por display (transparente, alwaysOnTop 'screen-saver',
          hasShadow:false, sem moldura) mostrando a imagem congelada ─► mira + leitura de pixel ─► seleção
          ─► recorte em coordenadas FÍSICAS do display ─► PNG (JPEG q85 se > 800 KB) ─► .expxv/capturas/ ─► editor
```

Capturar **antes** de abrir o overlay (imagem congelada) resolve de uma vez: não capturar o próprio overlay, Retina/multi-monitor
(escala por display) e o atraso de uma segunda captura.

## Modelo de dados

Preferências em `preferencias.json` (D-29, chaves `voz_*` e `captura_*`); segredos fora dele. Banco: migration
`NNNN-voz-captura.ts` (próximo número livre), uma transação.

| Onde | Campo | Observação |
|---|---|---|
| preferencias | `voz_motor` | `nenhum` (padrão) \| `comando_local` \| `http_compativel` |
| preferencias | `voz_motor_comando` | caminho do executável + modelo de argumentos (lista, nunca string de shell), validado na gravação |
| preferencias | `voz_motor_url`, `voz_motor_modelo` | só `http_compativel`; URL `https:` (ou `http://127.0.0.1` para servidor local do usuário) |
| preferencias | `voz_modo` | `fiel` (padrão) \| `ingles_tecnico` (exige refino configurado) |
| preferencias | `voz_idioma` | `pt` (padrão) \| `en` — **sempre** enviado explícito (bug de detecção russa da spec 07) |
| preferencias | `voz_disparo` | `segurar` (padrão) \| `alternar` |
| preferencias | `voz_atalho` | padrão mac `Cmd+Shift+Space`, Win/Linux `Ctrl+Shift+Space` (D-61) |
| preferencias | `voz_historico_persistir` | `false` (padrão, D-66) |
| preferencias | `captura_atalho_regiao`, `captura_atalho_quadros`, `captura_fps_padrao` | padrões: ver T-11.20; fps 2 |
| cofre (`safeStorage`) | `voz_chave_stt`, `voz_chave_refino` | arquivo `<userData>/segredos.bin` 0600; nunca legível pelo renderer |
| `consentimento` (tabela) | `servico` (`voz_stt`\|`voz_refino`\|…), `host`, `concedido_em`, `versao_texto`, `revogado_em` | único por (servico, host); revogar derruba o uso na hora |
| `voz_termo` | `id`, `termo`, `dica`, `criado_em` | dicionário técnico; alimenta `prompt` do STT e a substituição |
| `voz_fala` | `id`, `criado_em`, `modo`, `duracao_ms`, `palavras`, `ppm`, `estado` (`injetada\|cancelada\|falhou`), `codigo_erro`, `texto_final` | **só se** `voz_historico_persistir`; teto 200 linhas, TTL 7 dias; o histórico em memória (padrão) vale só na sessão do app |
| `captura` | `id` (`cap_…`), `workspace_id` (nullable), `tipo` (`imagem\|quadros`), `caminho` (relativo à raiz; sem workspace: relativo a `<userData>/capturas`), `bytes`, `largura`, `altura`, `anotada`, `fps`, `quadros`, `pane_id` (nullable), `criado_em` | `quadros = ceil(duração_s × fps)` no máximo; original preservado como `*.orig.png` |

Invariantes: áudio bruto **não** é persistido (D-62); `texto_final` só existe com `estado = injetada`; caminho de captura sempre sob
`.expxv/capturas/` (ou `<userData>/capturas`); o app **nunca apaga** captura sozinho (só por ação explícita, indo para a lixeira do
sistema); consentimento é por (serviço, host) e a mudança de URL do motor invalida o consentimento anterior.

## Contratos novos (a mesclar em `05-CONTRATOS.md` na T-11.22)

IPC (`window.ade`), todos com validador estrito no main e autorização por remetente; renderer **nunca** envia caminho, `cwd` nem
executável fora do que o validador aceita.

```ts
// ---- voz ----
type CodigoErroVoz = "sem_rede" | "chave_recusada" | "limite_de_uso" | "microfone_negado" | "microfone_indisponivel"
  | "motor_ausente" | "motor_falhou" | "consentimento_ausente" | "fala_vazia" | "fala_curta" | "tempo_esgotado"
  | "sem_terminal_em_foco" | "cancelado";
type EstadoDitado = "ocioso" | "gravando" | "transcrevendo" | "refinando" | "injetando" | "erro";
interface EstadoVoz { motor: "nenhum"|"comando_local"|"http_compativel"; motor_pronto: boolean; consentimento: boolean;
  microfone: "concedida"|"negada"|"indeterminada"|"restrita"; modo: "fiel"|"ingles_tecnico"; idioma: "pt"|"en";
  disparo: "segurar"|"alternar"; atalho: string; ditado: EstadoDitado }

"voz:estado":            { entrada: undefined; saida: EstadoVoz }
"voz:config_gravar":     { entrada: { patch: Partial<ConfigVoz> }; saida: EstadoVoz }          // chave vai em voz:segredo_gravar
"voz:segredo_gravar":    { entrada: { nome: "voz_chave_stt"|"voz_chave_refino"; valor: string|null }; saida: { ok: true } }
"voz:consentir":         { entrada: { servico: "voz_stt"|"voz_refino"; host: string; aceitar: boolean }; saida: { ok: true } }
"voz:testar_motor":      { entrada: undefined; saida: { ok: boolean; latencia_ms: number|null; erro: CodigoErroVoz|null } }
"voz:pedir_microfone":   { entrada: undefined; saida: { estado: EstadoVoz["microfone"] } }      // só após o diálogo explicativo
"voz:abrir_ajustes":     { entrada: { painel: "microfone"|"tela" }; saida: boolean }
"voz:iniciar":           { entrada: { sessao_id: string; disparo: "segurar"|"alternar" }; saida: { ok: boolean; codigo: CodigoErroVoz|null } }
"voz:parar":             { entrada: undefined; saida: { ok: boolean } }
"voz:cancelar":          { entrada: undefined; saida: { ok: boolean } }
"voz:dicionario_listar|salvar|remover" · "voz:historico_listar|limpar"
// envio (sem resposta)
"voz:audio":             { entrada: { sequencia: number; dados: Uint8Array /* PCM16 LE, 16 kHz, mono, ≤ 64 KiB */ } }
// eventos
"voz:estado_mudou":      { sequencia: number; ditado: EstadoDitado }
"voz:texto":             { fala_id: string; texto: string; injetada: boolean; codigo: CodigoErroVoz|null }
"voz:erro":              { codigo: CodigoErroVoz; estagio: EstadoDitado }

// ---- captura ----
"captura:estado":              { entrada: undefined; saida: { tela: "concedida"|"negada"|"indeterminada"|"restrita"; atalho_regiao: string; atalho_quadros: string; fps_padrao: 1|2 } }
"captura:pedir_tela":          { entrada: undefined; saida: { estado: ...; reiniciar_app: boolean } }   // macOS exige relançar
"captura:regiao":              { entrada: { fonte: "tela"|"janela_app" }; saida: { captura_id: string|null } }   // null = cancelada
"captura:quadros_iniciar":     { entrada: { fonte: "tela"|"janela_app"; fps: 1|2 }; saida: { ok: boolean } }
"captura:quadros_parar":       { entrada: undefined; saida: { captura_id: string|null } }
"captura:listar":              { entrada: { workspace_id: string|null; depois: string|null }; saida: Pagina<Captura> }
"captura:ler":                 { entrada: { captura_id: string }; saida: { bytes: Uint8Array; tipo: "png"|"jpeg" } }
"captura:salvar_edicao":       { entrada: { captura_id: string; png: Uint8Array /* ≤ 25 MiB */ }; saida: { ok: boolean } }
"captura:anexar_ao_pane":      { entrada: { captura_id: string; sessao_id: string }; saida: ResultadoAnexos }  // sem Enter
"captura:copiar_caminho":      { entrada: { captura_id: string }; saida: boolean }
"captura:remover":            { entrada: { captura_id: string }; saida: boolean }                     // lixeira do sistema
// overlay (preload próprio, só janelas de overlay; nunca o renderer principal)
"captura:overlay_selecao":     { entrada: { display_id: number; x: number; y: number; largura: number; altura: number } }  // coordenadas lógicas
"captura:overlay_cancelar":    { entrada: { display_id: number } }
// eventos
"captura:mudou":               { captura_id: string; acao: "criada"|"editada"|"removida" }
"captura:quadros_progresso":   { quadros: number; maximo: number; decorrido_ms: number }
```

`AcaoMenu` ganha `ditado`, `capturar`, `gravar-quadros` (menu, paleta ⌘K e bandeja). Eventos de domínio (barramento): `voz.started|
cancelled|injected|failed` e `captura.saved|frames_extracted` (nomes com ponto, sem conteúdo de fala nem caminho absoluto).

Tool MCP: **nenhuma** (D-65).

## UI (compacta, D-32)

- **Ditado**: um botão de microfone de 22 px **na linha única de controles** da tela Terminais (entre buscar e o contador "N
  aguardando"). Estados por forma + `aria-label` (nunca só cor): ocioso (contorno), gravando (preenchido azul, anel pulsante que some
  com `prefers-reduced-motion`, mini-barra de nível de 14 px), processando (spinner de 12 px), erro (`!`). Segurar o botão também
  grava (`pointerdown`/`pointerup`). Mensagens em toast compacto de uma linha, 2,5 s ("Sem motor de voz — configurar").
- **Atalho**: `⌘⇧Espaço` (mac) / `Ctrl+Shift+Espaço` (Win/Linux), segurar = gravar, soltar = enviar; `Esc` cancela; modo alternar
  opcional (debounce 300 ms). O atalho é interceptado no `keydown` do documento **antes** do xterm; `repeat` ignorado; perda de foco,
  `visibilitychange`, troca de Pane ou `pointercancel` encerram como cancelar.
- **Configurações → Voz e captura** (uma seção, três grupos de linhas curtas): Motor (nenhum / comando local / HTTP compatível),
  consentimento com o texto exato "o áudio será enviado a `<host>`", idioma, modo, atalho com **teste de tecla** (só salva se o
  `keydown`/`keyup` reais chegaram), dicionário (lista virtualizada acima de 100), histórico (liga/desliga, limpar), permissões
  (microfone e tela com estado, botão "Abrir Ajustes do Sistema"), atalhos de captura e FPS padrão.
- **Primeiro uso**: diálogo próprio de uma tela — o que será usado, para quê, o que **não** acontece (sem upload sem seu aceite, sem
  gravar em disco), como desfazer — com os botões "Continuar" (chama o diálogo do SO) e "Agora não".
- **Captura**: overlay por display, tela cheia sobre a imagem congelada, mira em cruz de 1 px, readout `x,y · WxH` (10 px), ESC
  cancela. Depois da seleção abre o **editor** (janela do app, tela lazy "Capturas"): barra única de 28 px com seta, caneta vermelha,
  retângulo, texto, desfazer, "Anexar ao Pane" (destino = Pane em foco), "Copiar caminho". Galeria compacta (miniaturas 64 px,
  virtualizada). A gravação por quadros mostra um indicador fixo `● 12/60 · 2 fps` no rodapé até parar (ESC ou o mesmo atalho).
- **Rodapé (26 px)**: indicador discreto "● mic" **só** enquanto grava; nada quando ocioso.
- Estados vazios e de erro dizem o próximo passo (sem motor: como configurar; sem permissão: abrir Ajustes; macOS: "reabra o app
  depois de conceder a gravação de tela").

## Tarefas

Formato: `T-11.NN · título` — entrega · aceite binário · depende. Todas seguem TDD (teste antes, vendo-o falhar), `npm run verificar`
verde; as de UI herdam P-01..P-14 e D-32. Áreas de arquivo disjuntas estão em "Ordem de execução".

### 11A — Fundação de privacidade e permissões
- **T-11.01 · Permissões do SO e pacote** — `src/main/permissoes.ts` (status/pedido de microfone e tela via `systemPreferences`,
  abrir Ajustes), `setPermissionRequestHandler`/`CheckHandler` **restritos** (hoje negam tudo, `main.ts`): só `media` de áudio, só
  origem do scheme do app, só a janela principal e só com o consentimento de primeiro uso registrado; tela nunca por esse caminho;
  `electron-builder.yml` (`mac.entitlements` com `com.apple.security.device.audio-input`, `extendInfo` com
  `NSMicrophoneUsageDescription` em PT-BR, hardened runtime quando houver assinatura), `build/entitlements.mac.plist`.
  Aceite: pedido de permissão de outra origem/outro tipo continua negado (teste do handler); Windows `restrita/indeterminada`
  tratados sem lançar; teste de configuração confere plist e usage description; nenhum pedido ao SO acontece antes da ação do usuário
  (stub de `askForMediaAccess` nunca chamado no boot). · F0, T-00.08.
- **T-11.02 · Cofre de segredos e consentimentos** — `nucleo/privacidade/{consentimento,segredos,redacao}.ts`, `main/segredos.ts`
  (`safeStorage.encryptString` → `<userData>/segredos.bin`, 0600, escrita atômica; sem `isEncryptionAvailable()` o segredo **não é
  gravado** e o recurso fica desligado com mensagem clara), tabela `consentimento` (migration), `voz:segredo_gravar`/`voz:consentir`.
  Aceite: valor jamais volta ao renderer (a API só devolve `tem: boolean`); varredura de log/diagnóstico/argv não acha o segredo
  de teste; sem criptografia disponível nada é gravado em claro; revogar consentimento é imediato. · T-00.05, T-00.06.
- **T-11.03 · Redação e varredura de privacidade** — `redacao.ts` (mascara chaves/tokens/`Authorization` em qualquer texto que vá a
  log ou diagnóstico) e teste de varredura que falha se `console.*`/logger receber `texto_final`, `texto` de fala ou conteúdo de
  campo `segredo`. Aceite: 30 padrões de chave/token mascarados; o teste de varredura falha ao introduzir um `console.log(texto)`
  de propósito (mutação). · T-11.02.

### 11B — Voz
- **T-11.04 · Captura de áudio no renderer** — `renderer/voz/{capturaAudio.ts,worklet-pcm.js}` (asset estático servido pelo scheme,
  sem `blob:`), `getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})` aberto **só ao iniciar**, AudioWorklet →
  PCM16 LE 16 kHz mono em blocos de 4–64 KiB, nível RMS a ≤ 20 Hz só para o indicador, fechamento garantido (`track.stop()` em
  `finally`, `blur`, `visibilitychange`, `pagehide`). Aceite: com `getUserMedia` falso, `tracks ativos = 0` depois de parar,
  cancelar, erro e `pagehide` (P-49); bloco > 64 KiB nunca é enviado; reamostragem de 48 kHz para 16 kHz mantém a duração
  (±1%). · T-11.01.
- **T-11.05 · Acumulador de fala e WAV** — `nucleo/voz/wav.ts`: acumula blocos em ordem (`sequencia`, duplicado e fora de ordem
  descartados), teto 120 s, cabeçalho WAV, descarta fala < 300 ms (`fala_curta`) e silêncio (`fala_vazia`, limiar de energia
  configurável), `zerar()` sobrescreve o buffer. Aceite: 120 s = 3 840 000 bytes de PCM; 299 ms descartado, 300 ms aceito;
  silêncio não chega ao motor; `zerar()` deixa o buffer vazio (P-43). · —.
- **T-11.06 · Interface `MotorStt` e adaptador de comando local** — `motores/{motor,comando-local}.ts`: `executavel` + `args` como
  **lista** com marcadores `{wav}`/`{idioma}`/`{modelo}`; `spawn` sem shell; `cwd` temporário; WAV em `os.tmpdir()/<prefixo>-voz-<rand>/`
  0700, apagado em `finally` (inclusive em timeout/kill); timeout 60 s e saída ≤ 1 MiB; leitor tolerante de transcrição (JSON
  `text|transcript|transcription` ou texto puro). Aceite: o motor falso transcreve; executável ausente → `motor_ausente`; timeout
  mata a árvore e apaga o WAV; **nenhum** WAV sobra no tmp depois de 20 execuções (incluindo falhas); caminho do executável com
  espaço e aspas funciona sem shell. O ExpxV **nunca baixa nem instala** runtime de STT (D-60). · T-11.05.
- **T-11.07 · Adaptador HTTP compatível (remoto, opt-in)** — `motores/http-compativel.ts`: `POST <url>/audio/transcriptions`
  multipart (`file`, `model`, `language` explícito, `prompt` = termos do dicionário), chave do cofre em `Authorization`, **exige
  consentimento do host** (sem ele nem abre o socket), `https:` obrigatório (exceção: `127.0.0.1` do usuário), 1 retry em 5xx/rede,
  erros → `sem_rede`/`chave_recusada` (401/403)/`limite_de_uso` (429)/`motor_falhou`, buffer retido para retentar uma vez. Aceite:
  contra um servidor HTTP **falso em loopback**; sem consentimento = zero conexão (contador de sockets do teste); URL trocada
  invalida o consentimento; a chave nunca aparece em log nem no corpo do erro; áudio nunca vai por query string. · T-11.02, T-11.05.
- **T-11.08 · Pós-processamento e refino opcional** — `pos-processo.ts`: dicionário (substituição determinística case-aware,
  ordem estável), espaço entre falas consecutivas, **sanitização para o PTY** (remove ESC e demais controles, troca quebras de
  linha por espaço, teto 4 000 caracteres, nunca CR/LF final); `motores/refino.ts`: modo `ingles_tecnico` por `POST /chat/completions`
  (prompt-base da spec 07 §8, temperatura 0,2, "output only the final text"), **segundo consentimento** próprio, desligado por
  padrão; falha do refino → injeta o texto bruto + aviso (nunca perde a fala). Aceite: `config.json` e `Supabase` do dicionário
  sobrevivem; `\x1b[31m` e `\r` na fala nunca chegam ao PTY; refino fora do ar → texto bruto + `voz:erro` informativo; sem
  consentimento do refino o modo `ingles_tecnico` não ativa. · T-11.06, T-11.07.
- **T-11.09 · Máquina do ditado** — `maquina.ts`, pura, relógio injetado: `ocioso → gravando → transcrevendo → [refinando] →
  injetando → ocioso`; `cancelar` válido em qualquer estado (ESC, blur, troca de Pane, fechar janela); `segurar` e `alternar`
  (debounce 300 ms; segundo toque dentro do debounce ignorado; sem desligar sozinho); erro volta a `ocioso` em 3 s; uma fala por
  vez. Aceite: tabela de transições completa (incluindo todas as combinações estado × evento); toggle não desliga em 2 s; fala
  durante `transcrevendo` é recusada com toast, não enfileirada. · —.
- **T-11.10 · Serviço de voz no main e injeção no Pane** — `main/voz.ts` (construído **no 1º uso**), liga acumulador + motor +
  máquina + pós-processo e escreve no PTY **do Pane de destino resolvido pelo main** (`sessao_id` do renderer é só a indicação,
  validada contra o workspace da janela) por `terminais:escrever`, **sem Enter**; sem Pane em foco → `sem_terminal_em_foco`, texto
  vai ao histórico (copiável) e **não** ao clipboard automaticamente. Aceite: e2e com CLI de eco: texto aparece uma vez, sem
  newline; ESC antes de soltar → nada escrito; Pane fechado no meio → `cancelado`; histórico em memória não persiste ao fechar o
  app (padrão); P-41 e P-48. · T-11.04, T-11.08, T-11.09.
- **T-11.11 · Atalhos: segurar, alternar e porta de tecla global** — `renderer/voz/usarDitado.ts` (keydown/keyup, interceptação
  antes do xterm, `repeat` ignorado, encerramento por blur/visibility/pointercancel), `nucleo/voz/teclas.ts` com a porta
  `TeclaGlobal`: adaptador `globalShortcut` **só para alternar** (Electron não detecta key-up nem modificador isolado — é o motivo
  do desenho), adaptador `nativo` que responde `indisponivel` até a pendência P-35. Teste de tecla na configuração. Aceite:
  segurar 1 s grava ~1 s; `Option` direita isolada **não** é aceita como atalho (mensagem explica); alternar global registra
  e libera o atalho (`unregister`) ao desligar e ao sair; conflito com atalho do menu é recusado; Windows usa `Ctrl+Shift+Space`
  (D-37, nada de `Ctrl+letra`). · T-11.09.
- **T-11.12 · IPC `voz:*` e preload** — validadores estritos (`voz_chave_*` só dois nomes; URL e executável revalidados no main;
  `dados` ≤ 64 KiB e `sequencia` monotônica), registro em `compartilhado/ipc.ts`, teste de formato do preload, autorização por
  remetente. Aceite: payload inválido recusado antes do manipulador; um canal sem validador falha o teste de contrato;
  `voz:audio` de outra janela/subframe é recusado. · T-11.10, T-11.11.
- **T-11.13 · UI de voz** — `BotaoVoz.tsx` na linha de controles, `SecaoVoz.tsx`/`SecaoPermissoes.tsx`, diálogo de primeiro uso,
  teste de tecla, toasts. Aceite: RTL dos 4 estados (rótulo acessível ≠ só cor); sem motor → o botão abre a configuração em vez
  de gravar; consentimento exibe o host exato; sem salto de layout ao gravar; sem `window.confirm`; linha única preservada (teste
  de D-32 mede a fração da altura ≥ 0,90 da área útil). · T-11.12, T-11.01.
- **T-11.14 · Histórico opt-in e dicionário persistido** — migration `voz_termo`/`voz_fala`, repositórios, retenção (200/7 dias),
  limpar tudo. Aceite: com `voz_historico_persistir=false` **nenhuma** linha de `voz_fala` é escrita (teste no banco real);
  ligado, o teto e o TTL valem; `texto_final` só em `injetada`; consulta quente ≤ 5 ms (P-14). · T-11.12.

### 11C — Captura
- **T-11.15 · Fontes de captura e geometria** — `nucleo/captura/{geometria,imagem}.ts`, `main/captura.ts` (lazy): fonte `janela_app`
  (`webContents.capturePage`, **sem permissão do SO**) e fonte `tela` (`desktopCapturer.getSources` com `thumbnailSize =
  bounds × scaleFactor` por display), porta `FonteTela` injetável (falsa nos testes), detecção de imagem toda em branco/transparente
  (sinal de permissão negada) → estado `negada` com instrução, sem exceção. Aceite: display 1440×900 com fator 2 gera 2880×1800 e o
  recorte lógico (100,100,300,200) vira (200,200,600,400) físico; dois displays com fatores diferentes recortam certo; imagem em
  branco → `negada`; PNG ≤ 800 KB senão JPEG q85 (extensão correta); nome `YYYY-MM-DD_HH-mm-ss.png` sem colisão. · T-11.01.
- **T-11.16 · Overlay de seleção multi-monitor** — `main/captura-overlay.ts` + `preload-overlay.ts` (preload mínimo, canais
  `captura:overlay_*` apenas): uma `BrowserWindow` por display (`transparent`, `frame:false`, `hasShadow:false`, `alwaysOnTop:
  'screen-saver'`, `visibleOnAllWorkspaces`, `skipTaskbar`, `focusable` para o ESC), mostrando a **imagem congelada** do display,
  mira em cruz + readout de pixel, seleção por arrastar, `< 5×5` px cancela, ESC cancela, **destruição garantida** em
  `finally`/`closed`/saída do app. Aceite: e2e com `FonteTela` falsa: arrastar gera PNG só da região; ESC não grava nada; **0**
  overlays vivos ao final em todos os caminhos (sucesso, cancelar, erro, app fechando) (P-45); o overlay nunca aparece na própria
  captura; P-44. · T-11.15.
- **T-11.17 · Armazém de capturas** — `nucleo/captura/armazem.ts`, tabela `captura` (migration), `.expxv/capturas/` com `.gitignore`
  interno `*` (reuso do mecanismo de `.expxv/`), sem workspace → `<userData>/capturas/`, original preservado como `*.orig.png`
  ao primeira edição, listagem paginada por cursor, remoção **só por ação** e para a lixeira (`shell.trashItem`). Aceite: caminho
  sempre relativo e sob a pasta permitida (tentativa de `..` recusada); o app nunca apaga arquivo sozinho (teste lista o diretório
  antes/depois de 50 capturas); disco sem permissão de escrita → erro claro, nada pela metade (escrita atômica). · T-11.15.
- **T-11.18 · Editor de anotação** — `renderer/telas/captura/` (chunk lazy ≤ 30 KB gz, Canvas 2D, **sem dependência**): seta, caneta
  vermelha, retângulo, texto, desfazer/refazer, autosave a cada 10 s **só se houver mudança**, salvar ao copiar e ao fechar,
  atalhos de teclado completos. Aceite: desenhar seta + "Copiar caminho" → arquivo contém a seta (comparação de pixels) e o
  `.orig` fica intacto; desfazer volta ao pixel anterior; sem mudança não regrava; chunk dentro de P-47. · T-11.17.
- **T-11.19 · Gravação por quadros (sem ffmpeg)** — `nucleo/captura/quadros.ts` + `main/captura.ts`: amostragem de 1 ou 2 fps pela
  mesma fonte, `.expxv/capturas/quadros/<ts>/frame_0001.png…`, teto 60 s e 120 quadros, parar por ESC/atalho/limite, backpressure
  (nunca acumula quadros em memória: grava e solta), contador para o rodapé. Aceite: 5 s a 2 fps = 10 quadros (±1) e 1 fps = 5;
  parar fecha em ≤ 1 s; main nunca > 50 ms (P-12, P-46); sem permissão de tela → falha clara no primeiro quadro, nenhum arquivo
  órfão; **sem dependência nova** (decisão D-65: nada de `ffmpeg-static`, ~70 MB). · T-11.15, T-11.17.
- **T-11.20 · Anexar ao Pane e atalhos de captura** — `captura:anexar_ao_pane` reutiliza `anexos` (T-01.08: recusa arquivos de
  ambiente, symlink para fora, copia para `.expxv/entradas/` quando precisa) e escreve o caminho formatado no PTY **sem Enter**;
  arrastar a miniatura para o Pane faz o mesmo; "Copiar caminho" coloca o caminho **absoluto** no clipboard (ação explícita do
  usuário); botão "inserir prompt de quadros" escreve `The folder <path> contains N frames sampled at F fps…` (texto da spec 08
  §8), nunca sozinho; atalhos padrão captura `Cmd+Shift+5`/`Ctrl+Shift+5`, quadros `Cmd+Shift+6`/`Ctrl+Shift+6` — **sem tocar nos
  atalhos nativos do macOS** (D-65), registrados no menu (não globais) e opcionalmente por `globalShortcut` (liga/desliga na
  configuração). Aceite: e2e: capturar → "Anexar ao Pane" → o eco mostra o caminho certo, sem Enter; Pane fechado entre captura e
  anexo → erro nominal; atalho do SO nunca é registrado/alterado (teste confere ausência de `defaults write`/equivalente). ·
  T-11.16, T-11.17, T-11.12.
- **T-11.21 · IPC `captura:*`, menu, paleta, bandeja** — validadores, preload (+ preload do overlay), `AcaoMenu`, entradas na
  paleta ⌘K e na bandeja ("Capturar região", "Gravar quadros"), tela lazy "Capturas" dentro de Terminais (painel lateral
  recolhível, sem novo item no menu lateral). Aceite: contrato de canais verde; overlay não consegue chamar canais `captura:` que não
  sejam `overlay_*`; paleta lista as ações; P-02 inalterado. · T-11.19, T-11.20.

### 11D — Fecho
- **T-11.22 · Auditoria de privacidade e segurança** — suíte `tests/privacidade.e2e.test.ts` + teste estático: (1) rede bloqueada por
  stub e o teste afirma **zero** tentativas de conexão com voz/captura sem consentimento; (2) varredura do tmp: nenhum áudio fora do
  WAV temporário 0700 e nenhum sobra; (3) log/diagnóstico sem conteúdo de fala; (4) `getUserMedia` só em `gravando`; (5) overlays e
  janelas de captura destruídos; (6) nenhum import de `child_process` com `shell: true` em `nucleo/voz`; (7) handler de permissões
  nega o que não é microfone do app. Aceite: tudo verde e a mutação "remover o consentimento" derruba o teste (1). · T-11.10,
  T-11.16, T-11.19.
- **T-11.23 · Perf, pacote e contratos** — P-40..P-49 em `tests/perf` (mic e fonte falsos), `test:pacote` (plist, entitlement,
  worklet), mesclar canais/tabelas em `05-CONTRATOS.md`, atalhos em `04-UI-UX.md`, `STATUS.md`. Aceite: `ultimo.json` verde com os
  10 orçamentos; `test:pacote` verde; contratos e atalhos documentados; checklist manual do portão registrado. · T-11.22.

## Casos de teste (resumo; cada item vira teste nomeado)

1. Segurar a tecla, falar, soltar → texto aparece uma única vez no Pane em foco, **sem Enter**; duas falas seguidas = "A B".
2. ESC durante a gravação, durante a transcrição e durante o refino → nada é injetado, buffer zerado, mic fechado.
3. Sem motor configurado → o botão leva à configuração; nenhuma conexão e nenhum download acontecem.
4. Motor HTTP sem consentimento → zero conexão; com consentimento → uma chamada; trocar a URL invalida o consentimento.
5. 401 → `chave_recusada`; 429 → `limite_de_uso`; sem rede → 1 retry e `sem_rede`; o texto/áudio não se perde no 1º retry.
6. `config.json` e `Supabase` preservados pelo dicionário; fala com ESC (`\x1b[31m`) e CR não chega ao PTY como controle.
7. Modo `ingles_tecnico` sem refino/consentimento recusa ativar; refino fora do ar injeta o texto bruto com aviso.
8. Microfone negado → estado claro + botão de Ajustes, sem laço de pedidos; revogado depois → `microfone_negado` ao tentar.
9. Fala de 299 ms descartada; silêncio descartado; 121 s corta em 120 s e avisa.
10. Captura de região em tela fator 2 recorta os pixels certos; dois monitores com fatores diferentes idem; < 5×5 cancela.
11. Overlay nunca aparece na imagem; 0 overlays vivos depois de sucesso, ESC, erro e saída do app.
12. Permissão de tela negada → imagem em branco detectada, instrução clara (e "reabra o app" no macOS), sem crash.
13. Anotar e copiar: o arquivo contém a seta, `.orig` intacto, clipboard tem o caminho; sem mudança o autosave não regrava.
14. Quadros: 5 s @ 2 fps = 10 (±1); 1 fps = 5; parar em ≤ 1 s; sem permissão → falha no 1º quadro sem órfãos.
15. Disco sem permissão de escrita → erro claro; nada gravado pela metade; o app nunca apaga captura sozinho.
16. Pane fechado entre captura e anexo → erro nominal; sessão de outra janela recusada no validador.
17. Boot: nenhum serviço de voz/captura criado (P-48); com o app empacotado a variável de mic falso é ignorada.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `globalShortcut` do Electron **não detecta key-up nem modificador isolado** (Option direita da spec 07 é impossível) | Hold-to-talk **dentro do app** (DOM `keydown`/`keyup`), alternar global opcional, porta `TeclaGlobal` com hook nativo adiado e condicionado a pendência (P-35: `uiohook-napi` = módulo nativo + Input Monitoring + custo de pacote). Mensagem de configuração explica a limitação |
| Permissão de **microfone** no macOS: em dev o pedido é atribuído ao Terminal; no pacote exige `NSMicrophoneUsageDescription` + entitlement com runtime endurecido; sem assinatura (P-03) o pedido pode nunca aparecer | T-11.01 deixa plist/entitlements prontos e testados por configuração; diálogo próprio antes do SO; estado `restrita/negada` com atalho para Ajustes; checklist manual registrado; P-36 |
| Permissão de **tela** no macOS exige relançar o app após conceder; `desktopCapturer` devolve imagem em branco sem permissão | Detecção de imagem em branco, mensagem "reabra o app", fonte `janela_app` sem permissão como alternativa funcional |
| **Retina e multi-monitor**: coordenadas lógicas ≠ físicas, fatores por display, overlay invisível (janela transparente sem `hasShadow:false`/Spaces) | Congelar por display com `thumbnailSize = bounds × scaleFactor`, recorte puro e testado, `visibleOnAllWorkspaces`, e2e com fonte falsa de fator 2, checklist manual com monitor Retina real |
| **Windows**: DPI por monitor, sem validação em máquina Windows (D-26), SmartScreen sem assinatura, UIPI | Geometria pura testada com fatores 1/1,25/1,5/2; atalhos `Ctrl+Shift+tecla`; risco registrado, P-06 |
| Áudio é dado pessoal: vazamento por log, histórico ou rede | D-64 (consentimento por serviço+host, desligado), T-11.02/T-11.03/T-11.22; histórico só em memória por padrão (D-66); WAV temporário 0700 apagado em `finally`; sem telemetria |
| Executável de STT escolhido pelo usuário pode ser qualquer coisa | Executável **da pessoa**, sem shell, argumentos em lista, validados na gravação, nunca derivados de texto de fala; o ExpxV não baixa nem instala nada (diferente do ExpxMedia, que baixa instalador remoto) |
| Texto ditado com sequência de controle vira comando no terminal | Sanitização antes do PTY (ESC/controles/CR/LF removidos, teto 4 000) e **nunca** Enter automático |
| Captura pode conter segredos | Fica local, em `.expxv/capturas/` ignorada pelo git; nenhum upload, nenhum MCP de captura; anexar ao Pane é ação explícita; aviso na primeira captura |
| Vazamento de overlay/mic/processo em erro | `finally` em todos os caminhos, testes de "0 overlays/0 tracks/0 WAVs", `tests/limpeza.ts` e conferência de `ps` ao fim |
| Quadros a 2 fps de tela 5K pressionam memória | Gravar e soltar cada quadro, teto de 120, backpressure, P-45/P-46 |

## Ordem de execução e paralelismo

```
T-11.01 ─┬─► T-11.04 ─┐
T-11.02 ─┤            ├─► T-11.10 ─► T-11.12 ─► T-11.13 ─► T-11.14
T-11.03 ─┘  T-11.05 ─► T-11.06 ─► T-11.07 ─► T-11.08 ─┘        │
            T-11.09 ───────────────► T-11.11 ───────────────────┤
T-11.01 ─► T-11.15 ─► T-11.16 ─┐                                │
                  └─► T-11.17 ─┼─► T-11.18                      │
                       └────────► T-11.19 ─► T-11.20 ─► T-11.21 ┴─► T-11.22 ─► T-11.23
```

Frentes **em paralelo** (áreas de arquivo disjuntas), depois de T-11.01 a T-11.03:

| Frente | Tasks | Áreas |
|---|---|---|
| A — núcleo de voz (puro) | T-11.05, T-11.06, T-11.07, T-11.08, T-11.09 | `src/nucleo/voz/**`, `tests/fixtures/stt-falso.mjs` |
| B — áudio no renderer e atalhos | T-11.04, T-11.11, T-11.13 | `src/renderer/voz/**`, `src/renderer/telas/terminais/BotaoVoz.tsx`, `src/renderer/telas/config/Secao*.tsx` |
| C — captura (núcleo + main) | T-11.15, T-11.16, T-11.17, T-11.19 | `src/nucleo/captura/**`, `src/main/captura*.ts`, `src/main/preload-overlay` |
| D — editor e galeria | T-11.18 | `src/renderer/telas/captura/**` |

Integração (agente principal, em série): T-11.10, T-11.12, T-11.14, T-11.20, T-11.21 (tocam `main/ipc/*`, `compartilhado/ipc.ts`,
`preload.ts`, `main.ts`, `menu.ts`), depois T-11.22 e T-11.23. Ninguém edita `compartilhado/ipc.ts` e `preload.ts` fora da
integração.

## Decisões [LAC] resolvidas (resumo; texto completo em `01-DECISOES.md`)

| [LAC] da spec | Decisão |
|---|---|
| Toggle vs hold (07) | [DEC] segurar é o padrão; alternar opcional com debounce 300 ms (D-61) |
| Hold com modificador isolado/fora do app | [DEC] impossível com `globalShortcut`; hook nativo adiado (P-35) |
| Motor de STT e modelo de refino (07) | [DEC] adaptador por contrato; nenhum embarcado; padrão sem motor (D-60) |
| Entitlement/trial/Pro/Ultra (07, 08) | [DEC] cortados (D-05); sem paywall |
| Prompt de refino (07) | [DEC] prompt-base da spec 07 §8, "output only the final text" |
| Modo Legal/Leigo (07) | [DEC] cortado (D-05) |
| Retenção do histórico (07) | [DEC] só em memória; persistir é opt-in, 200 linhas/7 dias (D-66) |
| Atalhos finais de captura (08) | [DEC] `Cmd/Ctrl+Shift+5` e `+6`, sem tocar nos nativos do macOS (D-65) |
| Formato do arquivo/"link" (08) | [DEC] PNG (JPEG q85 se > 800 KB); caminho relativo no Pane, absoluto só no clipboard por ação explícita |
| ffmpeg para frames (08) | [DEC] sem ffmpeg: amostragem direta de quadros (D-65) |
| Destino da injeção (07/08) | [DEC] PTY do Pane em foco, sem Enter, sem clipboard/Acessibilidade (D-63) |
