# Estudo de ameaças — Fase 25 (decisor local laya)

T-25.01. Escrito **antes de qualquer código da fase** (portão bloqueante: nem tipo, nem migration, nem esqueleto de
serviço existe quando este documento foi fechado). Mesmo formato de `seguranca/AMEACAS-FASE-21.md`; vocabulário das
Fases 13 e 20. **Herda e não duplica**: (a) de `docs/ade/AUDITORIA-VOZ-LOCAL.md` tudo que é download consentido de
modelo (achados A1..A15 valem aqui por referência — mesmo downloader, mesmo catálogo versionado, mesma disciplina de
sha256/consentimento/progresso); (b) de `docs/ade/AMEACAS-TELEGRAM.md` o tratamento de **texto não confiável** (F2
daquele estudo: dado que entra normalizado, redigido, com teto, e nunca decide ação). Este documento escreve só o que
é **novo** na Fase 25: o motor de decisão tipada, a fila, os consumidores e a tool MCP.

Validado por `tests/scripts/ameacas-fase25.test.ts` (toda ameaça Alta aponta para uma task `T-25.NN` que existe em
`fase-25-laya-local.md` e para um teste; caso `pronto` = teste existe e passa; `planejado:<onda>` = critério de aceite
da onda, fechado em T-25.20). A suíte adversarial central é `src/nucleo/laya/adversarial.test.ts` (um teste nomeado
`apNN_*` por caso, preenchido onda a onda — molde da Fase 20).

## 1. Fronteiras de confiança

```
   rede hostil / CDN ──F1 (download consentido; herdado da voz: host+sha256 do catálogo)──►  pesos .onnx em
                                                                                            │  <dados>/laya/<id>/
   texto de CLI, erro, evento (DADO NÃO CONFIÁVEL)                                          ▼
        ──F2 (teto+normalização+redação na entrada; nada é persistido)──►  processo runtime laya (NDJSON, nice baixo)
   pessoas/usuário                                                                          │
        ◄──F3 (decisão TIpada + confiança; SEMPRE atrás da regra determinística)──  fila (taxa, coalescência,
   consumidores (Maestro, roteamento, sinais, tool MCP)          timeout ≤ 500 ms)  ◄──────┘
        ──F4 (runtime ↔ app: processo próprio, protocolo versionado, crash isolado)──►  main (serviço preguiçoso)
```

| Fronteira | O que cruza | Controle |
|---|---|---|
| F1 rede ↔ download | bytes dos pesos `.onnx` | **herdado da voz** (A1..A11): renderer só envia `modelo_id`; host, caminho e sha256 vêm do catálogo versionado; `cliente-http` recusa salto de host fora da allowlist; sha256 em streaming; arquivo atômico; **zero rede fora do download** (G4) |
| F2 texto não confiável ↔ laya | saída de terminal, mensagens de erro, eventos, rótulos de conta/modelo | modelo de entrada fechado (§5): teto de bytes e de tokens, UTF-8 normalizado, **redação na entrada**, truncagem contada; o texto redigido nunca é gravado (D-699); só métricas agregadas saem |
| F3 laya ↔ consumidores | `DecisaoLaya` tipada (`choice`/`score`/`noul` + confiança) | decisão é **sugestão**: a regra determinística vence sempre (D-698); abstenção/erro/timeout/morto = fallback puro (comportamento de hoje); nenhum consumidor bloqueia (G1) |
| F4 runtime ↔ app | NDJSON versionado (pedido/resposta por id) | processo próprio com addon do pacote (nada do download é executável — G3); `nice` baixo; ociosidade encerra; crash = `laya_falhou` + 1 retentativa + desligar (D-707); carga re-verifica sha256 |

## 2. Inventário de ativos

1. **Pesos `.onnx`** em disco (integridade = sha256 do catálogo; trocá-los muda as sugestões). 2. **RAM/CPU da
máquina** (o laya divide com terminais, workers e app). 3. **Texto que passa pela entrada** (saída de CLI, erros —
pode conter segredo ou texto hostil de terceiros). 4. **Confiança do usuário nas sugestões** (rótulo/ordem errada
crônica = manipulação por indireção). 5. **Estabilidade do app** (crash do addon não pode derrubar o main).
6. **Disco/banda** no download. 7. **A autoridade das regras** (o bem mais importante: nada do laya pode substituir
`pickAccount`, tabela de equivalência, D-21/D-640..646).

## 3. Atores

| Ator | Pode | Não pode (garantia) |
|---|---|---|
| Pessoa (dono/usuário) | baixar/apagar pesos, ligar/desligar, editar taxa/limiar/ociosidade | ser executado sem consentimento por download |
| CLI/agente (por tool MCP) | chamar `laya_decide` **se o Pane ligar por opt-in** (T-25.19) | vazar resposta com texto; passar do teto/txa do Pane; ligar a tool sozinho |
| Texto de terceiros (saída de CLI, PR/issue/erro) | entrar como DADO na pergunta | decidir ação (G1); sair redigido de volta em log/artefato/evento (D-699) |
| Rede hostil / CDN comprometida | servir bytes diferentes no download | passar no sha256 do catálogo (herdado A2/A4) |
| Outro processo local do mesmo usuário | trocar o peso em disco | passar na re-verificação de sha256 a cada carga (AP-03) |
| Runtime ONNX (grafo carregado) | gastar CPU/RAM, crashar | derrubar o app (processo próprio, F4); executar rede (G4: `laya/` sem `net`/`fetch`) |
| Renderer comprometido | enviar payloads inválidos nos canais `laya:*` | escolher URL/host/caminho (validador estrito: só `modelo_id` — herdado A1) |

## 4. STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Catálogo `resources/laya/modelos.json` | viaja no pacote assinado; campo livre proibido | revisão por commit; sha256 por arquivo | — | sem dado pessoal | tamanho declarado por arquivo | entrada `a_verificar` = recusa `sem_checksum` |
| Download (espelho da voz) | herdado A1/A2 | herdado A4/A5 | herdado A7 | herdado A9 | herdado A5/A6 | herdado A10/A11 |
| Runtime (processo próprio) | spawn só com peso `pronto` + serviço ativo | NDJSON versionado, resposta casada por `pedido_id` (AP-17) | crash = `laya_falhou` + 1 retentativa; depois desligado | eventos só com métricas | timeout ≤ 500 ms; `nice` baixo | ociosidade encerra; apagar exige processo morto |
| Fila de decisões | — | coalescência por chave (sem troca de resposta) | descarte contado | — | taxa máxima/min (padrão baixo) | excedente descartado, nunca enfileira |
| Decisão canônica (`decidir`) | entrada com teto e redação | truncagem contada | — | texto nunca persistido; só métricas com hash | teto de tokens do checkpoint | abstenção abaixo do limiar |
| Consumidores (Maestro/roteamento/sinais) | — | — | fallback puro nos três estados | rótulo com confiança na UI | ninguém bloqueia em `decidir` | a regra determinística vence em conflito |
| Tool MCP `laya_decide` | desligada em TODOS os modos de fábrica | auditoria como toda tool | — | resposta tipada **sem eco do texto** | taxa por Pane + teto de entrada | ativação só por opt-in do Pane |

## 5. Modelo de entrada fechado (F2)

1. **Origem**: só texto produzido por (a) buffer/screen de Pane (snapshot já existente da sinaleira), (b) mensagens
   de erro que chegam ao sistema (Pane/limites/missões), (c) eventos internos, (d) rótulos/ids de contas, modelos e
   CLIs (strings curtas de identificação, nunca chaves). **Nada mais**: nenhum arquivo é lido para o laya; nenhum
   conteúdo de cofre, arquivo de ambiente ou variável de ambiente entra.
2. **Codificação**: UTF-8 estrito; bytes inválidos são descartados na normalização (saída de terminal pode vir
   quebrada); controle (exceto `\n`/`\t`) vira espaço.
3. **Teto**: máximo de bytes por chamada (padrão 8 KB, configurável para menos) **e** de tokens do checkpoint
   (`contexto_max_tokens` do catálogo); trunca mantendo o **fim** (o mais recente) e grava só a contagem do descarte.
4. **Redação na entrada**: `redigirSegredos` do scrubber existente ANTES de o texto circular (runtime, memória de
   debug, evento) — o original não sai do consumidor. Sentinela de teste: `sk-ant-…` que entra nunca aparece em
   evento, log, erro ou artefato (AP-04).
5. **O que NUNCA entra**: binário, imagem, áudio; segredo de qualquer espécie (o scrubber roda, e o consumidor não
   produz campo de segredo); texto maior que o teto sem truncar; pedido sem `tipo` válido.
6. **Persistência**: zero. O texto lido não vai a banco, arquivo, evento ou histórico; só métricas agregadas
   (latência, confiança, categoria, hash curto do texto redigido) (D-699).

## 6. Casos de abuso (AP-01..AP-18)

Colunas: caso · severidade · mitigação · task do plano · teste nomeado (suíte adversarial `src/nucleo/laya/adversarial.test.ts`,
salvo indicação) · estado (`pronto` = teste existe e passa; `planejado:<onda>` = critério de aceite da onda).

| AP | Caso | Sev. | Mitigação | Task | Teste | Estado |
|---|---|---|---|---|---|---|
| AP-01 | Entrada gigante trava o runtime (DoS local de CPU) | Alta | teto de bytes/tokens por chamada, fila com taxa, timeout ≤ 500 ms, descarte contado | T-25.06, T-25.07 | `ap01_entrada_gigante_descartada` | planejado:A |
| AP-02 | Loop de decisões (consumidor pergunta a cada evento) vira mineração disfarçada | Alta | taxa máxima por minuto (padrão baixo), coalescência por chave, processo em `nice` baixo | T-25.06 | `ap02_loop_de_decisoes_limitado` | planejado:A |
| AP-03 | Peso corrompido/adulterado no disco (edição manual pós-download) | Alta | sha256 verificado no download e **re-verificado a cada carga**; falha = recusa + re-download | T-25.05, T-25.06 | `ap03_peso_adulterado_recusado` | planejado:A |
| AP-04 | Entrada com segredo vaza para log/artefato/evento | Alta | redação na entrada; texto nunca persistido; eventos `laya.*` só com métricas | T-25.07, T-25.09 | `ap04_segredo_nao_vaza` | planejado:A |
| AP-05 | Decisão influenciada por texto hostil (prompt injection clássico) | Média | encoder classificador (não gerador); entrada é dado sem instrução; a autoridade é a regra (D-698) | T-25.07, T-25.08 | `ap05_texto_hostil_nao_decide` | planejado:A |
| AP-06 | Crash do runtime derruba o app ou vira restart infinito | Alta | processo próprio; 1 retentativa; segunda queda = desligado até clique (D-707) | T-25.06 | `ap06_crash_isolado_uma_retentativa` | planejado:A |
| AP-07 | Tool `laya_decide` usada em laço por agente (custo/flood) | Alta | desligada por padrão, taxa por Pane, teto, resposta tipada sem texto de volta | T-25.19 | `ap07_tool_em_laco_limitada` (`src/nucleo/laya/adversarial.test.ts`) | planejado:D |
| AP-08 | Sugestão errada de roteamento manda trabalho para conta errada | Média | ordena apenas; `pickAccount`/equivalência decidem; rótulo e confiança na UI; telemetria de acerto | T-25.13, T-25.14 | `ap08_roteamento_sugere_nao_decide` | planejado:B |
| AP-09 | Abstenção silenciosa degrada para sempre sem ninguém ver | Média | contador de abstenções/erros por consumidor na UI do decisor | T-25.10 | `ap09_abstencoes_visiveis` (`src/renderer/telas/config/Laya.test.tsx`) | planejado:A |
| AP-10 | Download consome banda/disco sem controle (modelos grandes) | Média | tamanho declarado no consentimento, progresso, pausar/cancelar, contagem no medidor de disco | T-25.05 | `ap10_download_controlado` | planejado:A |
| AP-11 | RAM do laya sufoca a máquina com app + CLIs | Média | RAM medida no "testar", aviso no consentimento, encerrar por ociosidade curto | T-25.06, T-25.10 | `ap11_ram_enorme_encerra_e_avisa` | planejado:A |
| AP-12 | Estado de terminal classificado errado notifica demais (alarme falso crônico) | Média | sinal apenas, rótulo com confiança, limiar configurável, fallback heurística atual | T-25.15 | `ap12_alarme_falso_limitado` | planejado:C |
| AP-13 | `laya:modelo_apagar` apaga em uso / caminho fora da pasta do produto | Alta | recusa com processo vivo; caminhos relativos e ancorados (regra 12); apagar = encerrar antes | T-25.05, T-25.06 | `ap13_apagar_sozinho_nunca_fora` | planejado:A |
| AP-14 | Modelo `a_verificar` baixado por engano | Alta | entrada sem checksum confirmado = recusa `sem_checksum` (D-697) | T-25.04 | `ap14_sem_checksum_recusa` (`tests/scripts` do catálogo) | planejado:A |
| AP-15 | Rede do laya além do download (telemetria do runtime, update silencioso) | Alta | varredura: `laya/` sem import de `net`/`fetch` direto; rede só em `rede/` com consentimento | T-25.09, T-25.21 | `ap15_rede_sozinho_no_download` (`tests/scripts` de fronteira) | planejado:A |
| AP-16 | Falha do portão de runtime descoberta tarde (fase meio construída) | Alta | T-25.02 bloqueante antes de qualquer código; §3 de `base/L-laya-local.md` com medições e veredito | T-25.02 | `ap16_portao_runtime_bloqueante` (`tests/scripts/ameacas-fase25.test.ts`) | pronto |
| AP-17 | Resposta da fila casada com o pedido errado (confusão entre consumidores) | Média | protocolo com `pedido_id` único; resposta casada por id; resposta órfã descartada | T-25.06 | `ap17_resposta_casada_por_id` | planejado:A |
| AP-18 | Consumidor bloqueia esperando decisão (UI trava atrás do laya) | Alta | regra em código: `decidir` é sempre `Promise` com timeout + valor padrão; teste de não-regressão triplo | T-25.08 | `ap18_ninguem_bloqueia_em_decidir` | planejado:A |

Herdados por referência (não duplicados aqui): **A1..A15 de `AUDITORIA-VOZ-LOCAL.md`** para o downloader (SSRF,
redirect, traversal, checksum, tamanho, disco, troca pós-verificação, execução de binário, log, consentimento,
symlink, apagar com download ativo, órfão, runtime indisponível) e o bloco **F2/AB-10/AB-12 de
`AMEACAS-TELEGRAM.md`** para texto não confiável (dado → envelope → regra; redação na entrada e na saída).

## 7. Portões de segurança

- **G1 — de "texto de CLI/erro" para "ação executada":** o laya só devolve decisão tipada; ação é sempre da regra
  determinística (D-698). Nenhum consumidor de ação existe (G2 garante por construção).
- **G2 — de "decisão" para "aprovação/rigidez":** D-21/D-640..646 fora do alcance do laya — a tool e os consumidores
  não expõem nenhuma superfície dessas; o laya nunca aparece como justificativa de aprovação, `pane_spawn` ou nível
  de rigidez.
- **G3 — de "peso baixado" para "código executado":** pesos são DADOS ONNX verificados por sha256; o runtime é o
  addon assinado que viaja no pacote; nada do download é executável (herdado A8).
- **G4 — de "consulta local" para "rede":** produção com zero rede por decisão; a única rede da fase é o download
  consentido do catálogo fixo (D-114/D-695); varredura impede `net`/`fetch` em `laya/` (AP-15).
- **G5 — de "tool MCP" para "escala de custo":** `laya_decide` desligada por padrão em todos os modos, taxa por Pane,
  teto de tamanho, resposta tipada sem eco (D-702).

## 8. Riscos residuais (declarados; espelho em `PENDENCIAS-DO-DONO.md`)

- **R1 — Fraqueza zero-shot (declarada pelo próprio laya):** sem fine-tune por domínio, a qualidade das decisões
  tipadas é limitada. O limiar de abstenção e o fallback limitam o dano, mas sugestões ruins são esperadas até um
  eventual fine-tune local (D-705, fase futura do dono). O consentimento diz isso em português claro (D-704).
- **R2 — Host curinga do download** (herdado da voz): qualquer subdomínio da organização pode servir o arquivo; a
  integridade não depende do host, e sim do sha256 fixado no catálogo que viaja no pacote assinado.
- **R3 — Verificação rápida por tamanho + mtime na carga** (herdado A7): quem forja mtime e tamanho passa na rápida;
  a completa (botão "Testar") pega. Quem já escreve nos dados do usuário tem alcance muito maior.
- **R4 — Windows validado só em unidade/config** (D-26): `O_NOFOLLOW`/permissões POSIX não se aplicam; pacotes do
  addon declarados no portão, sem prova real de máquina.
- **R5 — Medição real é do dono:** carga, latência e RAM do modelo verdadeiro não foram medidas em desenvolvimento
  (agente nunca baixa pesos); os tetos P-702..P-704 são provisórios até `LAYA_MODELO_DIR`.
- **R6 — Injeção reduzida, não eliminável:** texto hostil pode enviesar a **sugestão** (não a ação — G1/G2 seguram a
  ação); o limiar de confiança, a coalescência e a autoridade da regra reduzem, mas não zeram, o viés da sugestão.

## 9. Veredito

**APROVADO** para executar **T-25.02** (portão de runtime go/no-go) e, se GO, as ondas A..D nas condições deste
estudo. Nenhuma task de implementação pode começar antes de T-25.02 registrado em `base/L-laya-local.md` §3
(AP-16). As decisões **D-695..D-708** estão confirmadas em `01-DECISOES.md`.
