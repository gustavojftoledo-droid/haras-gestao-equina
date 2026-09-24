# Equinos Manager — Inventário de Funcionalidades do Sistema Atual

**Documento de referência para a reconstrução do sistema.**
Descreve o que o sistema em produção faz hoje, para servir de checklist de paridade funcional.

- Versão analisada: `app_145.html` (arquivo único, ~21.500 linhas)
- Data do levantamento: 23/09/2026
- Método: extração direta do código-fonte em produção

---

## 1. Contexto técnico atual

Informação de contexto para a equipe — **não é recomendação de arquitetura**, é o que existe hoje.

| Aspecto | Situação atual |
|---|---|
| Arquitetura | Aplicação de arquivo único (HTML + CSS + JS inline), sem build step |
| Hospedagem | GitHub Pages (estático) |
| Banco de dados | Firebase Firestore — coleção única `harasData`, um documento por tipo de dado (ex: `horses_list`), cada documento contendo o array inteiro daquela entidade |
| Autenticação | Firebase Authentication (e-mail + senha) |
| Offline | Service Worker (cache do app) + persistência offline do Firestore (fila de gravações que sobe ao reconectar) |
| Instalação | PWA instalável (manifest, ícones, modo standalone, orientação retrato) |
| Controle de acesso | Implementado no cliente (esconde UI). **Não há enforcement no servidor visível no código** |

> ⚠️ **Ponto crítico para a reconstrução:** o modelo "um documento por entidade com o array inteiro" não escala (todo salvamento reescreve a coleção completa) e impede regras de acesso por registro. Ver seção 10.

---

## 2. Modelo de dados (entidades persistidas)

| Chave de armazenamento | Entidade |
|---|---|
| `horses_list` | Animais (plantel) |
| `manejos_list` | Manejos (casco, vacina, vermífugo, dente) |
| `treinos_list` | Atividades / treinos |
| `nascimentos_list` | Coberturas, prenhez e nascimentos |
| `visitas_repro_list` | Visitas e exames reprodutivos |
| `semen_lotes` | Estoque de sêmen (lotes + movimentações) |
| `vendas_cobertura` | Vendas de cobertura/doses |
| `estoque_produtos` | Produtos (alimento, medicamento, ferramenta, utensílio) |
| `estoque_movimentos` | Entradas e saídas de estoque |
| `dietas_list` | Dietas e seus itens |
| `grupos_list` | Grupos/lotes de animais |
| `piquetes_list` | Piquetes e ocupação |
| `transportes_list` | Transportes de animais |
| `tratamentos_list` | Tratamentos veterinários |
| `visitas_list` | Visitas veterinárias |
| `exames_animais` | Exames anexados por animal |
| `animal_registros_list` | Registros livres na linha do tempo do animal |
| `financeiro_lancamentos` | Lançamentos financeiros manuais |
| `funcionarios_list` | Funcionários |
| `usuarios_list` | Usuários do sistema e permissões |
| `consultoria_visitas_list` | Visitas técnicas de consultoria |
| `consultoria_avaliacoes_list` | Avaliações de animais em visita |
| `consultoria_propriedades_list` | Propriedades/clientes atendidos |
| `consultoria_formulacoes_list` | Formulações de dieta |
| `consultoria_fotos` | Fotos das visitas de consultoria |
| `auditoria_log` | Log de auditoria |
| `aux_lists` | Listas auxiliares editáveis (status, raça, categoria, pelagem, localização, associação, treinador, ferrador, veterinário, motorista, meio de transporte, etc.) |
| `config` | Configurações (valores de referência, categorias fora do rateio, dias de gestação, etc.) |
| `rel_selecoes`, `nf_aprendizado`, `dismissed_*` | Estados de tela e aprendizado de importação |

### 2.1 Campos do cadastro de animal
`codigo`, `nome`, `apelido` (exibido como "Prefixo"), `sexo`, `situacao` (Interno/Externo/Vendido), `status`, `nascimento`, `falecimento`, `peso`, `scoreCorporal`, `pelagem`, `raca`, `categoria`, `localizacao`, genealogia (`pai`, `mae`, `avopat`, `avopatmat`, `avomatpat`, `avomat`), frequências de manejo (`freqcasco`, `freqdente`, `freqvacina`, `freqvermifugo`), `proprietario`, `associacao`, `numeroRegistro`, `valor` + moeda, `comprador`, `dataVenda`, `compra`, `compradoDe`, `doador`, `fotoUrl`, `obs`, `criadoEm`.

---

## 3. Módulos e funcionalidades

### 3.1 Início (painel)
- Saudação contextual e resumo do dia.
- Cartões-resumo: plantel (ativos, machos/fêmeas/histórico), manejo (tarefas de hoje, atrasadas, próximos 7 dias), saúde (tratamentos em curso, exames, prenhezes).
- Chips de alerta clicáveis: tarefas atrasadas, alertas de estoque, dias sem backup.
- Agenda dos próximos dias (visões Dia / Semana / Mês).
- Atalhos para todos os módulos.

### 3.2 Calendário
- Tarefas previstas de Casco, Dente, Vacina e Vermífugo, calculadas automaticamente por animal.
- Visões Mês / Semana / Dia, navegação entre períodos.
- Detalhe do dia com ações diretas (concluir manejo, confirmar pagamento de salário).
- Origens de tarefa: manejos, tratamentos, protocolo de gestação, protocolo de potro, retorno reprodutivo, coleta de embrião, transporte, salário (dia 5), atividades.

### 3.3 Animais
- Cadastro completo do plantel (campos na seção 2.1).
- Genealogia com preenchimento automático dos avós quando pai/mãe já existem.
- Campo **Associação + Nº de Registro** com atalho para o site de consulta da associação (ABCPCC, ABCCMM, Sociedade Rural Argentina, ABCCRM).
- Foto por link ou do celular (redimensionada e embutida no registro).
- **Ficha do animal**: linha do tempo unificada (manejos, tratamentos, treinos, pesagens, registros livres), próximas tarefas, competições, custo do animal, genealogia visual (árvore), exames anexados.
- **Edição em lote** (inclusive peso, com registro na linha do tempo de cada animal).
- **Duplicados**: detecção e tela de comparação/unificação (merge campo a campo).
- **Importações**: animais, casco, nascimentos, treinos e nota fiscal (com aprendizado de layout).
- Ditado por voz para preencher o cadastro.
- Relatórios: Ficha Completa (genealogia), Lista Resumida, Custo por Animal, Lista Simples.
- Colunas da lista configuráveis; ordenação por qualquer coluna; filtros salvos.

### 3.4 Grupos
- Lotes livres de animais (ex: quem treina com determinado treinador, quem é acompanhado por um veterinário).
- Relatório por grupo.

### 3.5 Reprodução
Sub-abas: **Coberturas · Visitas/Exames · Protocolo de Vacinas · Sêmen · Venda de Cobertura · Relatório**

- **Coberturas**: matriz, pai, letra do ano, data, coberturas adicionais, transferência de embrião (receptora, data da ovulação, coleta, lavado do embrião), previsão de nascimento calculada, confirmação de prenhez, data de nascimento.
- Ao confirmar o nascimento: o potro entra automaticamente no plantel, ligado à genealogia dos pais, e entra no protocolo de vacinação de potro.
- Ao confirmar a prenhez: a matriz (ou a receptora, em caso de transferência) entra automaticamente no protocolo de vacinação de égua prenha.
- **Visitas/Exames reprodutivos** com ditado por voz.
- **Protocolo de Vacinas**: regras editáveis (por mês de gestação, dias antes do parto, meses após a cobertura), agenda calculada, marcação de aplicação, exportação.
- **Estoque de sêmen**: lotes por garanhão (lote/partida, tipo congelado/resfriado/fresco, doses, estoque mínimo, validade), entradas e saídas com destino, coluna "Último uso" e extrato completo de movimentações por lote.
- **Venda de cobertura**: comprador, lote/garanhão, doses, valor por dose com cálculo do total, situação (recebido / a receber), forma de pagamento. Dá baixa automática no estoque de sêmen (com o comprador como destino) e gera receita no Financeiro.
- Filtros por confirmação e por estação reprodutiva; relatórios de nascimentos.

### 3.6 Manejos
- Tipos: **Casco, Vacina, Vermífugo, Dente**, aplicáveis a vários animais de uma vez (edição em lote).
- Casco com subtipo de ferrageamento (casqueado/ferrado — mãos, pés, completo, reposição, repregar) e valores de referência configuráveis.
- Vacina/Vermífugo dão baixa no estoque e alocam custo por animal.
- Cálculo automático da próxima data: usa a frequência do animal até o primeiro registro; depois passa a recalcular pelo tipo do último procedimento.
- Ferrador, deslocamento e extras.
- Relatórios: por manejo, financeiro, tabela, programação, manejo único, múltiplos manejos.
- Ditado por voz.

### 3.7 Veterinária
Sub-abas: **Lista · Visita · Tratamento**
- Visitas veterinárias com serviços (consulta, raio-X, ultrassom, acupuntura, fisioterapia) e valores de referência, produtos usados e rateio por animal.
- Tratamentos: medicamento, dose, meio de aplicação, período, com geração de tarefas no calendário e baixa de estoque.
- Exames anexados ao animal.
- Relatórios de histórico e de visitas.

### 3.8 Dietas
- Dietas com itens por horário (manhã/tarde/noite), animais vinculados, dias da semana.
- Consumo automático do estoque conforme a dieta ativa.
- Gráfico de projeção: quando cada alimento vai acabar, segundo o consumo diário.
- Alerta de estoque insuficiente para a dieta.

### 3.9 Estoque
Sub-abas: **Produtos · Movimentações · Relatório**
- Produtos por tipo (Medicamento, Alimento, Ferramenta/Arreio, Utensílio), unidade, preço, estoque mínimo, classe de medicamento, valores nutricionais (ED Kcal/kg, PB, Ca, P, Fibra Bruta, fonte de energia, indicado para idosos).
- Entradas e saídas com histórico por produto e ajuste de estoque.
- Alertas de estoque zerado/perto do mínimo.
- **Pedido de compra** por WhatsApp ou e-mail, com contato do fornecedor salvo por produto/tipo (abre o app do usuário com a mensagem pronta — não envia sozinho).
- Detecção de anomalias de consumo e de vínculos quebrados.
- Relatórios e exportação em PDF.

### 3.10 Atividades (treinos)
Sub-abas: **Histórico · Relatórios**
- Registro de treinos: tipo, local, treinadores (até 3), dono da tropa, animais participantes.
- Lista de chuckers no novo treino.
- Treino cobrado gera custo no Financeiro.
- Relatórios: treino único, três modelos de relatório, relatório de cobrança, relatório combinado de vários treinos.

### 3.11 Transporte
- Origem, destino, meio de transporte, motorista, animais transportados, valor do frete.
- Entra nas Próximas Tarefas da ficha do animal e no Financeiro.

### 3.12 Piquetes
- Cadastro de piquetes e dos animais usuários de cada um; registro de saída.

### 3.13 Consultoria (assistência técnica nutricional)
Sub-abas: **Visitas Técnicas · Histórico de Propriedade · Formulação · Comparação · Recomendação**
- **Propriedades/clientes**: nome, proprietário, cidade, histórico de visitas.
- **Visitas técnicas**: consultor, responsável, objetivo, animais avaliados, fotos, relatório em PDF.
- **Avaliação do animal** com fotos e observações.
- **Exigência nutricional (NRC)** calculada por peso, idade, categoria de atividade.
- **Formulação**: monta dieta customizada (item, horário, quantidade), para um animal, vários animais ou um grupo com peso médio; mostra exigência × fornecido × % atendimento, custo/dia, custo/mês, custo/kg.
- **Comparação**: várias formulações lado a lado (ingredientes, composição, atendimento, custo).
- **Recomendação de ração**: cruza a exigência que sobra após o volumoso com as rações cadastradas, pontua por custo, objetivo, natureza do esforço, idade e fibra, e explica o porquê de cada sugestão. Suplementos configurados ficam fora da comparação.
- Relatórios financeiro e nutricional das formulações.

### 3.14 Funcionários
- Cadastro de identificação (nome, documento, data de nascimento, observações).
- Lembrete automático todo dia 5 para confirmar pagamento de salário.
- Custos (salário, vale, adiantamento) lançados no Financeiro e usados no rateio por animal.

### 3.15 Financeiro
Sub-abas: **Lançamentos · Custo por Animal**
- Livro-caixa com entradas e saídas, categorias, moeda (R$ e US$ tratados separadamente), rateio por animal.
- **Lançamentos derivados automaticamente** de outros módulos (não são digitados duas vezes): Manejos, Estoque, Treinos, Visitas veterinárias, Tratamentos, Dietas, Piquete, Transporte, Venda de animal, Venda de cobertura. Cada um tem botão "Ver origem" que abre o registro que o gerou.
- Conceito de **natureza** do lançamento: `caixa` (dinheiro que entrou/saiu), `alocacao` (já pago na compra, só mostra em quem foi usado) e `previsto` (venda registrada e ainda não recebida).
- Indicadores: **Faturamento** (vendido, recebido + a receber), Entradas (recebido), Saídas, Saldo.
- Resumo do mês com gasto por categoria.
- **Custo por Animal**: custo direto por categoria (Alimentação, Saúde, Casco, Dente, Transporte, Atividades, Receptora, Transferência), com drill-down até o lançamento de origem; filtro por proprietário e por período; exportação em PDF.
- **Rateio dos custos gerais**: divide mês a mês o que não tem dono entre os animais ativos naquele mês, considerando entrada (data de cadastro) e saída (venda/falecimento); categorias podem ser marcadas como "fora do rateio" (investimento).
- Ditado por voz para lançamentos.

### 3.16 Usuários e permissões
- Usuários com nome, e-mail de login e perfil administrador.
- Permissões por módulo (`animais`, `grupos`, `nascimentos`, `manejos`, `veterinaria`, `transporte`, `treinos`, `estoque`, `funcionarios`, `financeiro`, `usuarios`, `consultoria`) × ação (**ver, inserir, editar, excluir**).
- Restrição extra por **tipo de manejo** (ex: usuário que só mexe em Casco).
- Permissão separada para ver valores financeiros dos animais.
- Prévia do acesso resultante antes de salvar.

### 3.17 Auditoria
- Registro de inclusão, alteração e exclusão: quem, o quê, quando, valores antes/depois, com nomes de campo legíveis.
- Busca e filtros por pessoa, tela e tipo de operação.
- Limite de retenção: 1.500 registros / 600 KB (corte automático dos mais antigos).

### 3.18 Filtros Sistema
- Edição das listas auxiliares que alimentam os filtros e selects (Sexo, Status, Categoria, Pelagem, Raça, Localização, Tipo de Atividade, etc.), com renomear/excluir e reaproveitamento nos registros existentes.

---

## 4. Funcionalidades transversais

- **Backup**: exportação de tudo em JSON, escolha de pasta local, lembrete de dias sem backup e importação aditiva (não sobrescreve).
- **Relatórios em PDF** em praticamente todos os módulos, com prévia antes de baixar e impressão.
- **Exportação de tabelas** em PDF respeitando filtros, ordem e colunas visíveis.
- **Ditado por voz** em Animal, Manejo, Produto, Lançamento, Nascimento e Visita reprodutiva.
- **Colunas configuráveis** e ordenação em todas as listas principais.
- **Deep link** por URL: `?animal=<id>` e `?view=<tela>`.
- **Atalhos de teclado** (Alt+Shift+letra por módulo, Ctrl+S para salvar, Enter para confirmar).
- **Modo offline** com fila de gravação e sincronização ao reconectar.
- **Diagnóstico** interno de dados e de vínculos quebrados.

---

## 5. Automações e regras de negócio (o "cérebro" do sistema)

Estas são as regras que mais importam preservar — é o que diferencia o sistema de um cadastro comum.

1. **Vencimento de manejo por animal**: frequência cadastrada até o primeiro registro; depois, recalculada pelo tipo do último procedimento.
2. **Protocolo de vacinação de égua prenha**: disparado automaticamente ao confirmar a prenhez, aplicado à matriz ou à receptora; regras configuráveis por mês de gestação e dias antes do parto.
3. **Protocolo de vacinação do potro**: disparado automaticamente ao registrar o nascimento.
4. **Previsão de parto**: calculada a partir da última cobertura pelos dias de gestação configurados.
5. **Consumo automático de dieta**: baixa diária do estoque conforme a dieta ativa e os dias da semana configurados.
6. **Projeção de término de estoque** por alimento, a partir do consumo.
7. **Exigência nutricional NRC** por peso, idade e categoria de atividade.
8. **Recomendação de ração**: calcula a exigência restante após o volumoso e pontua candidatas por custo, objetivo, natureza do esforço, idade e fibra (critério de fibra vale quando o volumoso fica abaixo de 50% do peso da dieta).
9. **Rateio mensal dos custos gerais** entre animais ativos no mês, respeitando entrada e saída do plantel.
10. **Custo por animal**: soma o que foi atribuído diretamente + a fatia do rateio geral.
11. **Baixa de estoque de sêmen na venda de cobertura**, com estorno automático na edição ou exclusão.
12. **Lançamentos financeiros derivados**: o Financeiro espelha o que está cadastrado nos outros módulos, sem digitação dupla e sem risco de contar o mesmo dinheiro duas vezes.
13. **Detecção de duplicados** de animais e de anomalias de consumo de estoque.

---

## 6. Integrações existentes

| Integração | Descrição |
|---|---|
| Firebase (Auth + Firestore) | Autenticação e banco de dados |
| WhatsApp / E-mail | Pedido de compra e reposição de estoque — abre o app do usuário com a mensagem pronta, **não envia automaticamente** |
| Sites de associações | Atalho para consulta do registro genealógico (ABCPCC, ABCCMM, SRA, ABCCRM) |
| Bot de Telegram (`equinos-bot`) | Cadastro de animal e registro de manejo por frase solta; IA externa extrai os campos, usuário confirma antes de gravar; grava direto no mesmo Firestore |
| Servidor MCP (`mcp-server`) | Somente leitura, sobre o backup JSON exportado — consulta de animais e vacinas pendentes por assistente de IA |
| pdf.js / jsPDF | Geração e leitura de PDF |

---

## 7. Perfis de uso

- **Administrador**: acesso total, gestão de usuários e permissões.
- **Operacional** (tratador, treinador, ferrador): acesso restrito a módulos e tipos de manejo específicos.
- **Consultor técnico**: módulo de Consultoria, atendendo propriedades de terceiros.
- **Proprietário de animais hospedados**: leitura de custo por animal filtrado por proprietário.

---

## 8. Volumetria de referência (produção)

- ~128 animais ativos, ~680 no histórico.
- Uso diário por múltiplos usuários, incluindo celular em campo (offline frequente).
- Histórico plurianual de manejos, financeiro e reprodução.

---

## 9. Requisitos não-funcionais observados no uso atual

- Funcionar **sem internet** no campo, sincronizando depois (requisito real, não opcional).
- Abertura rápida no celular; telas em português, linguagem não técnica.
- Impressão/PDF de qualquer listagem.
- Nenhum dado pode ser perdido em gravação concorrente (dois usuários editando ao mesmo tempo).

---

## 10. Pontos de atenção para a reconstrução (escala e segurança)

Levantados na análise do sistema atual — valem como requisitos do novo.

### Escala
1. **Modelo de armazenamento**: hoje cada entidade é um único documento com o array inteiro; toda gravação reescreve tudo. Precisa virar registro por linha, com índices e paginação.
2. **Gravação concorrente**: hoje depende de releitura antes de gravar; o novo precisa de transações/locking por registro.
3. **Carga inicial**: hoje o app baixa todas as coleções na abertura. Precisa de carregamento sob demanda.
4. **Limite do log de auditoria**: hoje corta por tamanho (1.500 registros); o novo precisa de armazenamento próprio e retenção definida por política.
5. **Anexos**: fotos são gravadas embutidas no próprio registro (base64), o que infla o banco. Precisa de storage de objetos com URL.

### Segurança e LGPD
6. **Autorização no servidor**: hoje as permissões são apenas de interface; qualquer usuário autenticado pode, em tese, acessar qualquer dado direto pela API. O novo precisa de autorização por registro e por campo no backend.
7. **Isolamento**: hoje todos os dados vivem numa coleção única, sem separação por organização/propriedade. Se houver multi-tenant (consultoria atende terceiros), precisa de isolamento real.
8. **Dados pessoais tratados**: funcionários (nome, CPF/RG, nascimento, salário), usuários (nome, e-mail), terceiros (compradores, vendedores, veterinários, ferradores, treinadores, motoristas, fornecedores) e clientes de consultoria (propriedade e proprietário).
9. **Base legal e aviso de privacidade**: não existem hoje. O novo precisa de política de privacidade, registro de finalidades e base legal por tipo de titular.
10. **Direitos do titular (art. 18 LGPD)**: hoje não há exportação nem anonimização por pessoa; excluir um funcionário deixa rastro no log e em lançamentos.
11. **Minimização**: CPF/RG é coletado sem uso funcional aparente — avaliar se deve existir no novo sistema.
12. **Backup**: hoje é um JSON sem criptografia salvo em pasta local, contendo todos os dados pessoais e financeiros. Precisa de backup criptografado e controlado.
13. **Segregação de credenciais**: o bot de Telegram usa chave de serviço com acesso total, ignorando qualquer regra de acesso.
14. **Retenção e expurgo**: não há política de retenção definida para nenhuma entidade.

---

## 11. Observação final

Este documento cobre **o que o sistema faz**, não como deve ser feito. Onde houver dúvida sobre uma regra de negócio específica (especialmente protocolos de vacina, cálculo NRC e rateio de custos), vale confirmar com o usuário antes de reimplementar — são regras ajustadas ao longo do uso real e há casos particulares embutidos.
