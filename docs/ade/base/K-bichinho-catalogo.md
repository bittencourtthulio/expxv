# K · Catálogo do bichinho: 100 espécies e afinidades (D-670 a D-674)

Gerado a partir de `src/nucleo/bichinho/catalogo.ts` e `afinidades.ts`. Texto em **negrito** na coluna de afinidades = a espécie é a PREFERIDA daquele sinal (1ª da lista); as demais pontuam por degraus (100%, 70%, 55%, 42%, 30%, 20%, 12%, 8%, 5%) e formam a fila de quando a preferida já está em uso.

Ordem de atribuição: pontos de preferência das 14 originais (linguagem/tipo → espécie original, como sempre), depois pontos de afinidade (todas as listas), depois hash FNV-1a de `nome do workspace + id + espécie`. A mais afim AINDA LIVRE vence; só com as 100 em uso há repetição, com variante visual.

## Mamíferos (48)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `esquilo` (legada) | Esquilo | Go | **go** | Rápido e enxuto: junta só o que precisa e corre em paralelo. |
| `raposa` (legada) | Raposa | JavaScript | **javascript** | Esperta e improvisada: acha atalho em qualquer ambiente. |
| `lontra` (legada) | Lontra | Java e Kotlin | **java**, **kotlin** | Sociável e persistente: boia na JVM com tudo organizado em pacotes. |
| `elefante` (legada) | Elefante | PHP | **php**, **Laravel** | Memória longa e veterano da web: nunca esquece uma requisição. |
| `ourico` (legada) | Ouriço | Ruby | **ruby** | Elegante por fora, cheio de espinhos de convenção por dentro. |
| `gato` (legada) | Gato | documentação | **markdown**, **tipo:docs** | Observador e independente: deita em cima do texto e o mantém em ordem. |
| `urso` (legada) | Urso | C e C++ | **c**, **cpp** | Forte e direto: levanta peso perto do metal, sem pedir licença. |
| `capivara` | Capivara | monorepos tranquilos | tipo:biblioteca | Zen e sociável: todo mundo encosta nela e o build continua calmo. |
| `lobo` | Lobo | servidores e trabalho em equipe | c, cpp, tipo:api, Express | Líder de matilha: coordena processos e não deixa nenhum worker para trás. |
| `tigre` | Tigre | desempenho e C++ de alto nível | cpp, PyTorch | Silencioso e preciso: ataca o gargalo de uma vez só. |
| `leao` | Leão | arquitetura e liderança técnica | csharp, cpp, **NestJS** | Majestoso: decide a arquitetura e a defende com rugido calmo. |
| `pantera` | Pantera | segurança | csharp | Discreta e atenta: vigia o perímetro do código no escuro. |
| `lince` | Lince | revisão de código e busca | typescript, TensorFlow, **scikit-learn** | Olhar afiado: acha o bug escondido a cem linhas de distância. |
| `guepardo` | Guepardo | velocidade e otimização | go, **Vite**, **Fastify**, FastAPI | Acelera do zero ao pico num instante, mas poupa fôlego. |
| `onca` | Onça | back-end robusto | tipo:api, NestJS | Força silenciosa da mata: segura o back-end sem pedir ajuda. |
| `panda` | Panda | bibliotecas e análise tabular | markdown, tipo:docs, **tipo:biblioteca**, **pandas** | Mastiga dependência com calma e nunca perde a ternura. |
| `coala` | Coala | Android e Kotlin | kotlin, tipo:mobile, Electron, **Android** | Abraça o galho do app e só acorda para o deploy. |
| `canguru` | Canguru | migrações e deploy | kotlin, tipo:mobile, Android | Carrega tudo na bolsa e salta de versão em versão. |
| `preguica` | Preguiça | jobs em lote e processos lentos | tipo:docs | Devagar e sempre: um job por vez, sem estourar a memória. |
| `tamandua` | Tamanduá | parsers e coleta de dados | python, tipo:dados, pandas | Língua comprida: puxa dado de qualquer formigueiro. |
| `tatu` | Tatu | defesa em profundidade | rust, c | Armadura de testes: enrola e nada o atinge. |
| `anta` | Anta | sistemas legados resistentes | csharp, php, Django, **Symfony** | Antiga, resistente e subestimada: atravessa o rio de código velho. |
| `suricato` | Suricato | monitoramento e observabilidade | tipo:infra | Sentinela: de pé no morro, avisa quando algo se move. |
| `lemure` | Lêmure | animação e interfaces vivas | javascript, tipo:mobile, Vue | Cauda listrada e agilidade: pula de componente em componente. |
| `macaco` | Macaco | scripts e automação | python, javascript, shell, tipo:cli | Curioso e ágil: pendura um script no outro até a tarefa fechar. |
| `gorila` | Gorila | infraestrutura pesada | cpp, tipo:infra | Força tranquila: levanta o cluster inteiro sem suar. |
| `cervo` | Cervo | interfaces elegantes | tipo:web, **Vue** | Gracioso e atento: cuida dos detalhes da tela. |
| `alce` | Alce | plataformas grandes | java, Angular, NestJS | Galhada ampla: abriga vários serviços sob o mesmo teto. |
| `camelo` | Camelo | resistência e longas jornadas | java, Spring | Atravessa o deserto de um refactor sem pedir água. |
| `lhama` | Lhama | IA e modelos de linguagem | python, tipo:dados, **PyTorch**, **TensorFlow**, scikit-learn | Pelo macio e cabeça fria: conversa com qualquer modelo. |
| `cavalo` | Cavalo | APIs e servidores de carga | java, tipo:api, **Next.js**, **Express**, Spring | Cavalo de trabalho: puxa requisição o dia inteiro. |
| `zebra` | Zebra | testes e tipagem | typescript, Angular | Listras de passa e falha: tudo é preto no branco. |
| `girafa` | Girafa | visão ampla e painéis | tipo:dados, tipo:web | Pescoço comprido: enxerga a arquitetura de cima. |
| `rinoceronte` | Rinoceronte | sistemas de baixo nível | rust, php, c, cpp, Symfony | Blindado e teimoso: atravessa a parede de segfaults. |
| `hipopotamo` | Hipopótamo | bancos de dados e SQL | java, php, tipo:dados | Boca enorme: engole tabela grande sem engasgar. |
| `javali` | Javali | desempenho bruto | go, c | Cabeça dura: abre caminho no código lento. |
| `porco-espinho` | Porco-espinho | validação de entrada | ruby | Espinhos de validação: entrada ruim não passa. |
| `castor` | Castor | build e CI | go, tipo:biblioteca | Construtor incansável: corta, empilha e entrega o pacote. |
| `ornitorrinco` | Ornitorrinco | integração e projetos poliglotas | kotlin, csharp | Mistura de tudo: bico, cauda e pelo, e funciona. |
| `vombate` | Vombate | refatoração e migração de dados | markdown, tipo:docs | Cavador: escava o legado e deixa a toca em ordem. |
| `quokka` | Quokka | protótipos e projetos pessoais | kotlin, tipo:biblioteca, **Svelte** | Sorriso de quem acabou de rodar o primeiro teste verde. |
| `morcego` | Morcego | tarefas agendadas e noturnas | shell | Acorda quando o cron toca e dorme de cabeça para baixo. |
| `coelho` | Coelho | scripts rápidos e protótipos | go, shell, tipo:cli, Svelte, Express | Salta de ideia em ideia e entrega antes do café esfriar. |
| `ovelha` | Ovelha | réplicas e contêineres | php, Laravel | Rebanho de réplicas: uma cai, outra assume. |
| `guaxinim` | Guaxinim | limpeza e scripts de shell | javascript, shell, tipo:cli | Fuça no lixo do repositório e devolve tudo limpinho. |
| `texugo` | Texugo | resiliência e testes teimosos | rust | Teimoso: não solta o bug até ele virar teste. |
| `bisao` | Bisão | monolitos de grande porte | csharp, php, tipo:api, Laravel, Symfony | Corpanzil de monolito: lento para virar, impossível de parar. |
| `foca` | Foca | front-end e interfaces | javascript, tipo:web, React | Equilibra a bola da interface no nariz e aplaude. |

## Aves (14)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `tucano` (legada) | Tucano | C# e .NET | **csharp** | Vistoso e confiável: bico grande para carregar solução inteira. |
| `coruja` (legada) | Coruja | dados, ML e análise | **tipo:dados**, pandas, **NumPy**, PyTorch, TensorFlow, scikit-learn, Jupyter | Noturna e analítica: enxerga padrão no escuro dos dados. |
| `arara` | Arara | front-end colorido | javascript, **tipo:web**, **React**, Next.js | Colorida e falante: dá cor e voz à interface. |
| `pinguim` | Pinguim | Linux e linha de comando | **shell**, **tipo:cli** | Elegante no gelo do terminal: desliza pelo shell. |
| `falcao` | Falcão | desempenho e vigilância | go, swift, Vite, Fastify, FastAPI | Mergulha do alto sobre a métrica que importa. |
| `corvo` | Corvo | pesquisa e mensageria | python, markdown, tipo:docs, **Jupyter** | Esperto: junta pistas e leva a mensagem certa. |
| `pavao` | Pavão | design e vitrines | typescript, tipo:web, React | Abre o leque: faz da tela uma vitrine. |
| `flamingo` | Flamingo | equilíbrio e cross-platform | React Native | Numa pata só: equilibra plataformas sem cair. |
| `pato` | Pato | tipagem dinâmica e dados analíticos | python, Django, **Flask**, Jupyter | Se anda como pato e grasna como pato, o teste passa. |
| `cisne` | Cisne | design e documentação limpa | typescript, swift, markdown, tipo:docs | Desliza sereno: nada de ruído na superfície. |
| `pelicano` | Pelicano | armazenamento e backup | tipo:dados | Bolsa grande: guarda dado para o dia de escassez. |
| `beija-flor` | Beija-flor | bibliotecas leves e mobile | swift, dart, tipo:mobile, tipo:biblioteca, Vite, React Native, **Expo**, **Flutter** | Minúsculo e veloz: paira sobre a menor dependência. |
| `avestruz` | Avestruz | ferramentas de linha de comando | shell, tipo:cli | Corre mais que o resto e enfia a cabeça só no log. |
| `gaivota` | Gaivota | nuvem e CDN | javascript, tipo:infra, Next.js | Plana sobre a nuvem e pousa onde a borda estiver. |

## Répteis (8)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `piton` (legada) | Piton | Python | **python** | Calma e legível: enrola o problema até ele caber numa linha. |
| `camaleao` (legada) | Camaleão | TypeScript | **typescript** | Atento aos tipos: muda de cor para combinar com cada contrato. |
| `tartaruga` | Tartaruga | suporte longo e estabilidade | rust, **Electron** | Devagar, segura e com casa própria: vai longe. |
| `jacare` | Jacaré | APIs e ORMs | **tipo:api**, **Django** | Boca aberta no pântano de requisições: nada escapa. |
| `lagarto` | Lagarto | scripts leves | python, shell, tipo:cli | Toma sol no terminal e some por uma fresta. |
| `iguana` | Iguana | front-end estruturado | typescript, tipo:web, **Angular** | Crista alinhada: tudo no seu componente. |
| `komodo` | Dragão-de-komodo | servidores de grande porte | hcl, tipo:infra | Pesado e paciente: espera o servidor render. |
| `osga` | Osga | microsserviços e apps pequenos | dart, tipo:mobile, Expo, Android | Gruda em qualquer parede e cabe em qualquer frestinha. |

## Anfíbios (4)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `sapo` (legada) | Sapo | mobile (Swift, Dart, Android) | **swift**, **dart**, **tipo:mobile** | Salta de tela em tela: leve, ágil e sempre na palma da mão. |
| `axolote` | Axolote | regeneração e hot reload | dart | Sorridente: perde um serviço e já nasce outro. |
| `salamandra` | Salamandra | tolerância a falhas | tipo:infra | Atravessa o fogo do incidente sem perder a cor. |
| `perereca` | Perereca | mobile multiplataforma | swift, dart, tipo:mobile, Vue, **React Native**, Expo, Flutter | Gruda em qualquer tela e salta entre sistemas. |

## Peixes e cetáceos (7)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `baleia` | Baleia | contêineres e Docker | hcl, tipo:infra | Carrega contêiner nas costas e canta no cluster. |
| `golfinho` | Golfinho | SQL e inteligência | java, kotlin, tipo:dados | Brincalhão e esperto: salta por cima da query lenta. |
| `tubarao` | Tubarão | segurança e auditoria | c | Fareja vulnerabilidade a quilômetros. |
| `arraia` | Arraia | APIs fluidas e streaming | tipo:api, **FastAPI** | Plana pelo fluxo de dados sem fazer onda. |
| `baiacu` | Baiacu | defesa e validação | php, tipo:api | Infla quando entra dado estranho. |
| `cavalo-marinho` | Cavalo-marinho | orquestração de serviços | hcl, tipo:infra | Cauda enrolada em cada serviço do cluster. |
| `peixe-lua` | Peixe-lua | grandes volumes de dados | tipo:dados, NumPy | Redondão e tranquilo: engole um oceano de logs. |

## Invertebrados (8)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `caranguejo` (legada) | Caranguejo | Rust | **rust** | Blindado e metódico: não deixa nada vazar, anda de lado até achar o caminho seguro. |
| `polvo` (legada) | Polvo | infraestrutura e DevOps | **hcl**, **tipo:infra** | Oito braços: segura pipeline, contêiner e cluster ao mesmo tempo. |
| `agua-viva` | Água-viva | serverless e nuvem | tipo:infra | Flutua sem servidor e brilha quando escala. |
| `estrela-do-mar` | Estrela-do-mar | sistemas distribuídos | hcl | Perde um braço e segue funcionando. |
| `lula` | Lula | mensageria e filas | go | Jato de mensagens: dispara e some na tinta. |
| `lagosta` | Lagosta | back-end blindado | rust | Carapaça dura, pinça firme: contrato é contrato. |
| `nautilo` | Nautilo | recursão e programação funcional | kotlin | Concha em espiral: cada câmara chama a anterior. |
| `caracol` | Caracol | self-hosted e apps empacotados | Electron | Leva a casa nas costas: roda em qualquer lugar. |

## Insetos e aracnídeos (11)

| Id | Espécie | Representa | Afinidades | Personalidade |
|---|---|---|---|---|
| `abelha` | Abelha | workers e colaboração | tipo:api | Colmeia organizada: cada worker no seu favo. |
| `joaninha` | Joaninha | caça a bugs e QA | ruby | Pintinhas de teste: devora bug pequeno antes de crescer. |
| `borboleta` | Borboleta | transformações e refatorações | ruby, dart, tipo:web, Flutter | Casulo de refactor: sai outra, mais leve. |
| `louva-a-deus` | Louva-a-deus | revisão de código | typescript | Imóvel e atento: só se mexe para apontar o erro. |
| `escaravelho` | Escaravelho | pacotes e bibliotecas | rust, ruby, tipo:biblioteca | Rola a dependência até o lugar certo. |
| `formiga` | Formiga | microsserviços e builds | java, tipo:cli, Flask, NumPy, **Spring** | Trilha de feromônio: pequena, mas faz milhões em paralelo. |
| `libelula` | Libélula | serviços leves e ágeis | tipo:biblioteca, Svelte, Fastify | Asas transparentes: paira sobre a latência. |
| `grilo` | Grilo | linters e consciência de qualidade | javascript | Canta baixinho cada aviso de lint. |
| `vaga-lume` | Vaga-lume | logs e observabilidade | ruby, tipo:biblioteca, Flask | Acende uma luz no breu do log. |
| `aranha` | Aranha | web e coleta de páginas | tipo:web | Tece a teia de links e sente cada vibração. |
| `escorpiao` | Escorpião | segurança ofensiva responsável | c | Cauda armada: só ferroa o que merece. |

## Frameworks que puxam espécies

| Framework | Fila de afinidade |
|---|---|
| React | Arara > Foca > Pavão |
| Next.js | Cavalo > Gaivota > Arara |
| Vue | Cervo > Lêmure > Perereca |
| Svelte | Quokka > Libélula > Coelho |
| Angular | Iguana > Zebra > Alce |
| Vite | Guepardo > Beija-flor > Falcão |
| Express | Cavalo > Coelho > Lobo |
| Fastify | Guepardo > Falcão > Libélula |
| NestJS | Leão > Onça > Alce |
| Electron | Tartaruga > Caracol > Coala |
| React Native | Perereca > Beija-flor > Flamingo |
| Expo | Beija-flor > Osga > Perereca |
| Django | Jacaré > Pato > Anta |
| Flask | Pato > Vaga-lume > Formiga |
| FastAPI | Arraia > Guepardo > Falcão |
| pandas | Panda > Coruja > Tamanduá |
| NumPy | Coruja > Formiga > Peixe-lua |
| PyTorch | Lhama > Tigre > Coruja |
| TensorFlow | Lhama > Lince > Coruja |
| scikit-learn | Lince > Coruja > Lhama |
| Jupyter | Corvo > Coruja > Pato |
| Spring | Formiga > Camelo > Cavalo |
| Android | Coala > Canguru > Osga |
| Laravel | Elefante > Ovelha > Bisão |
| Symfony | Anta > Bisão > Rinoceronte |
| Flutter | Beija-flor > Perereca > Borboleta |
