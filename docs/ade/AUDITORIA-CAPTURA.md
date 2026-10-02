# Auditoria da Fase 11: voz e captura (onda 1)

Escopo auditado: captura de tela, de janela e de região; gravação por quadros; anexo ao Pane; ditado por voz (motor local por padrão, motor remoto só com consentimento); permissões do SO; atalhos globais com opt-in. Código: `src/nucleo/{captura,voz,privacidade}`, `src/main/{captura*,voz,permissoes}.ts`, `src/main/ipc/{captura,captura-voz}.ts`, `src/renderer/{voz,telas/captura}`, `BotaoVoz.tsx`, `SecaoVozCaptura.tsx`, `build/entitlements.mac.plist`. Método: leitura do código contra `fase-11-voz-captura.md` e `DECISOES-DAS-PENDENCIAS.md`, suíte estática com mutação (`tests/privacidade-captura.test.ts`), testes unitários e de integração por camada e e2e escrito (`tests/captura.e2e.test.ts`, não executado nesta onda: exige `npm run build`).

## Veredito

Sem achado aberto de severidade alta ou média. Sete achados foram encontrados durante a construção e corrigidos com teste; quatro riscos residuais ficam registrados abaixo. Nada de voz ou captura sai da máquina sem consentimento por (serviço, host); áudio nunca vai a disco (exceto o WAV temporário do motor local, em pasta própria, apagado em `finally`); a captura fica local; nenhum log leva fala, chave ou imagem; o agente não tem tool de captura nem de voz (D-65).

## Verificações pedidas e a prova de cada uma

| Tema | Verificação | Prova (teste) |
|---|---|---|
| Permissões | Nada é pedido ao SO no boot nem ao abrir a tela; microfone só depois do diálogo do app; negada vira instrução, nunca laço de pedidos | `permissoes.test.ts` (criar o serviço não pede; pedir só quando indeterminada), `captura-boot.test.ts` (P-48: 0 serviços, 0 pedidos), `usarDitado.test.tsx` e `BotaoVoz.test.tsx` (aviso antes do SO), `SecaoVozCaptura.test.tsx` (abrir a tela não chama nada), `Fluxo.test.tsx` (diálogo antes de `pedirTela`; negada oferece Ajustes ou janela do app) |
| Permissões | Handler do Chromium nega tudo que não é áudio do scheme do app, da janela principal, depois do aviso | `permissoes.test.ts` (vídeo, tela, misto, outra origem, outra janela, antes do aviso), `privacidade-captura.test.ts` (6) |
| Permissões | Entitlement e texto de uso do microfone no pacote, nada além | `tests/scripts/captura-pacote.test.ts` |
| Imagem | A imagem congelada vive só em memória, com token de uso único e TTL de 90 s, e é zerada ao confirmar, cancelar, expirar ou encerrar; nenhuma janela extra | `captura.test.ts` (região: token errado não derruba a legítima, TTL, substituição, zerar), `privacidade-captura.test.ts` (5: sem `BrowserWindow`) |
| Imagem | A captura fica em pasta ignorada pelo git, modo 0700/0600, escrita atômica, nunca apagada sozinha, remoção só por ação e para a lixeira | `armazem.test.ts` (50 capturas não apagam nada; remover vai à lixeira; sem lixeira recusa; disco sem escrita não deixa `.tmp`) |
| Imagem | Sem upload: clipboard só em "Copiar caminho"; nunca Enter no PTY; não existe tool MCP | `privacidade-captura.test.ts` (5), `captura.test.ts` (anexar sem Enter) |
| Áudio | Microfone aberto só durante a fala; fecha em parar, cancelar, erro, blur, pagehide, visibilitychange, pointercancel, troca de Pane e desmontagem | `capturaAudio.test.ts` (0 trilhas ativas), `usarDitado.test.tsx`, `privacidade-captura.test.ts` (4) |
| Áudio | Em disco só o WAV do motor local, em `mkdtemp` (0700), apagado em `finally` inclusive em timeout e cancelamento; 20 execuções sem sobra | `comando-local.test.ts`, `privacidade-captura.test.ts` (2: só `comando-local.ts` escreve arquivo no módulo de voz) |
| Áudio | Buffer de fala em memória, teto de 120 s (3 840 000 bytes), zerado depois; 50 falas voltam ao baseline | `wav.test.ts`, `tests/perf/captura.perf.ts` (P-43) |
| Transcrição | Histórico só em memória (teto de 50 falas), nunca em preferências nem banco; some ao encerrar | `voz.test.ts` (histórico), `privacidade-captura.test.ts` (2) |
| Transcrição | Texto de fala é dado não confiável: ESC, CSI, OSC, CR/LF e bidi nunca chegam ao PTY; nunca Enter; teto de 4 000 | `pos-processo.test.ts`, `voz.test.ts` |
| Log | Nenhum log, erro ou diagnóstico leva fala, chave, áudio ou imagem; segredos são mascarados (34 amostras, mais de 30 famílias de padrão) | `redacao.test.ts`, `privacidade-captura.test.ts` (3, com mutação), `captura.ts`/`voz.ts` só usam `mensagemSegura` |
| Caminhos | Renderer nunca envia caminho: captura é id no formato do app; destino é o Pane revalidado no main; anexo reusa a allowlist, a recusa de arquivo de ambiente e de symlink para fora e devolve caminho relativo | `captura.test.ts` (ids com `../`), `ipc/captura.test.ts` (nenhum campo de caminho aceito, ids, tokens), `anexar.test.ts` (symlink, ambiente, relativo) |
| Envio | Motor remoto: sem consentimento vigente do host o socket nem abre; consentimento por host (trocar o host invalida); revogar derruba na hora, inclusive entre tentativas; chave só no cofre e só no cabeçalho; sem redirecionamento para outro host | `http-compativel.test.ts` (zero conexão, retry, revogação, 401/429), `voz.test.ts` (host exato, host diferente recusado), `privacidade-captura.test.ts` (1, com mutação), `consentimento.test.ts` |
| Envio | Toda saída de rede passa por `nucleo/rede` (https, sem IP, sem rede privada, sem log de corpo e query); `tests/scripts/empacotamento.test.ts` continua barrando módulo de rede novo | `http-compativel.ts` só importa o cliente, `privacidade-captura.test.ts` (1) |
| Processos | Motor local: executável ABSOLUTO escolhido pela pessoa, argumentos em lista, sem shell, ambiente mínimo (sem chaves de provedor), saída ≤ 1 MiB, timeout 60 s com morte da árvore | `comando-local.test.ts`, `privacidade-captura.test.ts` (6) |
| IPC | Validadores estritos (campo extra, `__proto__`, tipos, faixas), autorização por remetente antes do manipulador, `voz:segredo_gravar` sensível, erros genéricos sem stack nem caminho | `ipc/captura.test.ts`, `registro.test.ts` (lista de sensíveis), `preload.test.ts` (paridade) |

## Achados corrigidos (com teste)

| # | Severidade | Achado | Correção | Teste |
|---|---|---|---|---|
| A-01 | Alta | O Chromium só libera o microfone depois do aviso de primeiro uso, mas o hook só mostrava o aviso quando o SO ainda não tinha concedido: com o microfone já liberado pelo SO, o `getUserMedia` seria negado | O aviso é exigido sempre que `aviso_microfone_visto` for falso, independente do estado do SO | `usarDitado.test.tsx` (primeiro uso), `BotaoVoz.test.tsx` |
| A-02 | Média | Abrir Configurações com motor "nenhum" consultaria o cofre (`existe`), o que pode acordar o chaveiro do SO sem ação da pessoa | `tem_chave` só consulta o cofre com motor HTTP em uso | `captura-boot.test.ts` (voz:estado não abre o cofre) |
| A-03 | Média | A mascaração de segredos não pegava chave entre aspas em JSON (`"password": "..."`) | Separador aceita aspas de fechamento | `redacao.test.ts` |
| A-04 | Média | O motor HTTP aceitaria `http://127.0.0.1`, em desacordo com a camada de rede (que recusa IP, localhost e rede privada) e com a regra de "um único ponto de saída" | URL só `https` com nome de host, sem credencial, query ou fragmento; servidor local do usuário entra como motor de comando local; `permitirLoopbackHttp` existe só para servidor falso de teste | `consentimento.test.ts`, `http-compativel.test.ts`, `privacidade-captura.test.ts` |
| A-05 | Baixa | O aviso de "fala cortada em 120 s" se perdia (o acumulador zerava a flag antes de ser lida) | A flag é lida antes de finalizar | `voz.test.ts` (120 s) |
| A-06 | Baixa | Soltar a tecla enquanto o microfone ainda abria chamava `parar` duas vezes | `terminar` só marca a soltura enquanto abre; `iniciar` encerra uma vez | `usarDitado.test.tsx` |
| A-07 | Baixa | Seleção e anotação dependiam do estado do React entre eventos de ponteiro disparados no mesmo turno (a seleção podia nunca confirmar) | Estado lógico em `ref`, estado visual separado | `SeletorRegiao.test.tsx`, `Editor.test.tsx` |

## Riscos residuais (aceitos e registrados)

1. **Não validado em hardware real.** macOS (microfone, Gravação de Tela, Retina e multi-monitor), Windows (DPI por monitor) e o AudioWorklet no Chromium do Electron foram cobertos por stubs e jsdom. O checklist manual do portão (microfone real, monitor Retina, atalho dentro e fora do foco) continua pendente para a pessoa.
2. **Seleção de região só no display da janela do app.** O plano previa uma janela transparente por display; esta onda usa um seletor dentro do próprio app (a imagem congelada do display onde está a janela). Em troca, não existe janela de overlay para vazar (P-45: 0 janelas por construção). Multi-display fica para a onda seguinte, junto com a validação em máquina real.
3. **`desktopCapturer` pode entregar `display_id` vazio** em algumas plataformas; o adaptador cai para a fonte de mesmo índice. O pior caso é capturar outro monitor do mesmo usuário, localmente; nada sai da máquina. Conferir no checklist manual com dois monitores.
4. **O asset do worklet de áudio depende do empacotador.** `new URL("./worklet-pcm.js", import.meta.url)` é tratado como asset pelo Vite; o build não foi executado aqui (há `npm run dev` ativo). `tests/scripts/captura-pacote.test.ts` confere o arquivo e a CSP; a presença no `dist/renderer` deve ser conferida em `npm run test:pacote`.

## Decisões desta onda (para consolidar em `01-DECISOES.md`)

- **Sem migration.** O índice de capturas é o próprio diretório (id = nome do arquivo); consentimentos e dicionário ficam em `preferencias.json` (D-29); o histórico de falas é só memória (D-66, padrão). Evita divergência arquivo x tabela e disputa de número de migration; persistência opt-in do histórico fica para a próxima onda.
- **Chave de voz no cofre existente** (nome `VOZ_CHAVE_STT`, escopo global, sensível), em vez de um `segredos.bin` novo: uma só superfície de segredo, o mesmo scrubber e o mesmo comportamento sem `safeStorage`.
- **Motor HTTP só `https` por nome de host**, por `nucleo/rede` (A-04). Refino `ingles_tecnico` e segunda chave ficam fora desta onda (o modo "fiel" é o único).
- **Captura de região em três canais** (`regiao_iniciar` devolve a imagem congelada e um token, `regiao_confirmar` recorta em coordenadas lógicas, `regiao_cancelar` solta a memória) e eventos agregados `captura:evento`/`voz:evento`, no estilo dos demais canais da casa.
- **Atalhos:** dentro do app (⌘⇧5 região, ⌘⇧6 quadros; Ctrl+Shift+5/6 fora do macOS) por escuta do documento; globais só com opt-in persistido e registro revertido se o atalho estiver ocupado. Menu nativo e bandeja (`AcaoMenu`) ficam para depois, para não mexer em arquivos compartilhados por outras fases.
- **Perf:** P-41, P-43 a P-48 medidos em `tests/perf/captura.perf.ts` (P-47 por proxy estático de fonte gzip); P-40, P-42 e P-49 dependem do Electron real e ficam no e2e escrito, com cobertura jsdom (P-49: `capturaAudio.test.ts`, `usarDitado.test.tsx`).
