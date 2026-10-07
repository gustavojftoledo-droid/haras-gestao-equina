# Termos de Uso, Privacidade e LGPD — RASCUNHO PARA O ADVOGADO

> **Leia primeiro.** Este documento é um **rascunho técnico** feito por uma IA a partir de como o sistema funciona. **Não é aconselhamento jurídico** e **não garante, por si só, proteção legal.** Antes de qualquer cliente aceitar, um **advogado com experiência em LGPD e contratos de software (SaaS)** precisa revisar e adaptar tudo (nome/CNPJ, foro, valores, prazos). Os pontos que mais precisam do advogado estão marcados com **[ADVOGADO]**.
> Situação em 07/10/2026. Nada aqui está no app ainda, exceto o campo de registro de consentimento no painel de clientes.

Partes: **[NOME/CNPJ DO DONO DO SISTEMA]** ("**Plataforma**") e o **cliente** que contrata um plano ("**Cliente**").

---

## 1. Papéis na LGPD (Lei 13.709/2018)
- O **Cliente é o controlador** dos dados que ele cadastra (animais, proprietários, funcionários, contatos, financeiro). Ele decide o que cadastrar e para quê.
- A **Plataforma é operadora**: armazena e processa esses dados **só para prestar o serviço** e conforme as instruções do Cliente.
- Para os **dados da própria conta** (nome, e-mail de login, registros de acesso) a Plataforma é **controladora**.
- O Cliente declara ter **base legal** para cadastrar dados pessoais de terceiros (funcionários, proprietários, contatos) e responde por isso. **[ADVOGADO]**

## 2. Dados tratados
- **Conta e acesso:** nome, e-mail, papel/permissões, data do último acesso, auditoria de ações (quem fez o quê e quando).
- **Dados do Cliente:** cadastros de animais (podem identificar o proprietário), funcionários, contatos, estoque e consumo (ração, medicamentos), manejos, treinos, financeiro, fotos e documentos (exames).
- **Não é coletado** dado pessoal sensível de propósito. O Cliente **não deve** cadastrar dado sensível (saúde, biometria, etc. de pessoas) no sistema.

## 3. Segurança e infraestrutura (o que o sistema já faz)
- Cada cliente tem **espaço próprio e separado** (`tenants/<id>`); regras do banco impedem um cliente de ler o de outro.
- Acesso por **login individual**; permissões por módulo; **auditoria** de inclusões, edições e exclusões.
- Fotos e arquivos em armazenamento com **regras de acesso** por cliente.
- **Backups:** cópias diárias das listas críticas (10 dias) e **cópia mensal permanente** do estoque.
- **Subprocessadores** (terceiros que processam dados): **Google (Firebase/Google Cloud)** — banco, arquivos, login e funções, com servidores no Brasil (São Paulo) para arquivos/funções e conforme a localização do banco **[confirmar no console]**; **Cloudflare** e **Telegram** (somente o robô de avisos do haras do dono); **Anthropic** (IA do robô, quando usado). Há **transferência internacional de dados** para alguns deles. **[ADVOGADO: cláusulas e informação ao titular]**
- **Pontos que ainda faltam** (ver checklist, seção 9).

## 4. Direitos dos titulares e retenção
- O titular (ex.: funcionário, proprietário) exerce direitos (acesso, correção, eliminação, portabilidade) **junto ao Cliente**; a Plataforma **ajuda** o Cliente a atender (prazo: **[15] dias**). **[ADVOGADO]**
- **Retenção:** os dados ficam enquanto o contrato durar. Após o cancelamento, a Plataforma **mantém os dados do Cliente por [90] dias** para ele poder exportar/reativar e depois **elimina**; no caso de **inadimplência**, vale o prazo da seção 5.3 (**[12 meses]** para exportar ou regularizar, e depois eliminação definitiva), **exceto** o que a lei obrigue guardar e os **dados anonimizados/agregados** (seção 6). Backups se extinguem no ciclo normal. **[ADVOGADO: prazos]**
- **Incidente de segurança:** a Plataforma avisa o Cliente **sem demora injustificada** (meta: **até 48 h** após ciência) e colabora na comunicação à ANPD e aos titulares quando exigido.
- **Encarregado (DPO)/contato de privacidade:** **[NOME e E-MAIL]**.

## 5. Termos de Uso e Planos
**5.1 Planos e limites (tabela vigente em 07/10/2026; podem mudar com aviso prévio de [30] dias):**

| | Gratuito | Básico | Pro |
|---|---|---|---|
| Módulos | Animais, Manejos, Treinos, Estoque (+ gestão de usuários) | + Nascimentos, Veterinária, Transporte, Grupos | Todos |
| Fotos por animal | 1 | 4 | 8 |
| Usuários | 2 | 5 | Sem limite |
| Espaço de dados incluído | 200 MB | 1 GB | 5 GB |

**5.2 Excedente de espaço (decisão do dono):** no plano **Pro**, o uso de espaço **acima do limite incluído** é **cobrado do Cliente**, pelo custo repassado **[valor por GB/mês ou critério — definir; ex.: custo do provedor + X%]**, com **aviso prévio** quando o uso passar de **80%** e de **100%** do limite, e cobrança no ciclo seguinte. O Cliente **autoriza** essa cobrança ao contratar o Pro. Nos planos **Gratuito** e **Básico**, ao atingir o limite a Plataforma pode **bloquear novos envios** de fotos/arquivos e/ou propor mudança de plano, **sem cobrança de excedente**. **[ADVOGADO: validade da cobrança variável, forma de aviso, CDC se o Cliente for consumidor]**

**5.3 Pagamento, manutenção mínima dos dados e inadimplência (decisão do dono, 07/10/2026):**
- **Manter os dados guardados tem um custo mínimo mensal** de **[valor — definir]**. Enquanto o Cliente pagar **ao menos esse mínimo**, a Plataforma **mantém os dados dele guardados** (mesmo que ele deixe de usar os recursos do plano).
- **Falta de pagamento:** o acesso pode ser **bloqueado** (os dados continuam guardados). Durante os **[12 meses]** seguintes ao início da inadimplência, o Cliente **pode pedir a exportação dos próprios dados** e/ou **regularizar** o pagamento para recuperar o acesso. A Plataforma **avisa** o Cliente por e-mail **[quantas vezes e quando, ex.: ao bloquear, aos 6 meses, aos 11 meses]**.
- **Fim do prazo:** passados **[12 meses]** sem regularização, o Cliente **perde o direito de recuperar os dados** e a Plataforma pode **eliminá-los de forma definitiva**, **sem possibilidade de recuperação**, **sem indenização**. O Cliente reconhece que **teve prazo e meios** (exportação) para guardar os dados e que **é dele a responsabilidade de exportá-los**. Ficam ressalvados os **dados anonimizados/agregados** (seção 6) e o que a lei obrigue a guardar.
- **Aceite:** o Cliente concorda com essas regras **no aceite dos Termos** (primeiro acesso), com versão e data guardadas.
- **[ADVOGADO: validade da eliminação por inadimplência (CDC/LGPD arts. 15–16 e 18), forma de notificação que comprove ciência, prazo de 12 meses, exclusão sem indenização, e se o mínimo mensal vale para plano Gratuito (hoje não há cobrança no Gratuito — decidir se o Gratuito inativo também tem prazo de eliminação).]**

**5.4 Responsabilidades:** o Cliente responde pelo conteúdo cadastrado, pelo uso por seus usuários e pela guarda de senhas. A Plataforma responde pela disponibilidade **razoável** do serviço (**sem garantia de 100%**), pelos limites de responsabilidade a definir **[ADVOGADO: limite de responsabilidade e exclusões]**.
**5.5 Propriedade:** os dados cadastrados **pertencem ao Cliente**. O sistema e sua marca pertencem à Plataforma.
**5.6 Cancelamento:** o Cliente pode cancelar a qualquer momento; exportação de backup dos próprios dados disponível **[confirmar o formato]**.
**5.7 Foro e lei aplicável:** **[ADVOGADO]**.

## 6. Uso de dados agregados e anonimizados (parceiros: farmácias e empresas de ração)
Objetivo do dono: usar o histórico de **consumo de ração, medicamentos e estoque** de forma **agregada** para gerar informação de mercado (sazonalidade, consumo médio por período, etc.).

**Como o texto deve funcionar (a validar com o advogado):**
1. **Licença separada e clara** (aceite próprio, não escondido no meio dos Termos): o Cliente **autoriza** a Plataforma a usar **dados de consumo/estoque em forma anonimizada e agregada**, para estatísticas e para oferecer a **parceiros**.
2. **O que NUNCA sai:** nome do Cliente/haras, nomes de pessoas, e-mails, telefones, nomes e fotos de animais, localização exata, valores financeiros individuais, qualquer dado que permita **identificar** o Cliente, uma pessoa ou um animal.
3. **Regras técnicas mínimas:** só **totais por produto/período/região ampla**, com **mínimo de [5] clientes por número divulgado** (para não identificar ninguém) e **sem dado bruto**. Parceiros recebem **relatórios**, não acesso ao banco.
4. **Sem identificar = fora da LGPD?** Dados **efetivamente anonimizados** deixam de ser dado pessoal (art. 12), mas **a anonimização precisa ser real e comprovável**; se for reversível, continua sendo dado pessoal. **[ADVOGADO + revisão técnica]**
5. **Plano Gratuito:** o dono quer que o aceite da seção 6 seja **condição do plano gratuito**. Atenção: consentimento **condicionado** pode ser **questionado**; o advogado pode preferir apoiar isso em **contrato (licença de dados agregados como contrapartida do plano gratuito)** em vez de "consentimento". **[ADVOGADO — ponto crítico]**
6. **Revogação:** quem não aceita pode ficar nos planos **pagos** sem a licença (a decidir), e o Cliente pode **revogar** para usos futuros; dados já agregados e anonimizados não voltam.
7. **Registro:** o painel de clientes já guarda **aceito/não, data, versão do termo e quem registrou**. Falta o **aceite dentro do app** (ver checklist).

## 7. Cláusulas de proteção do dono (a revisar)
- Cliente **declara** que tem autorização dos titulares cujos dados cadastra e que **não** cadastrará dado sensível.
- Cliente **isenta** a Plataforma de responsabilidade por **dados que ele inseriu sem base legal** e por uso indevido pelos seus usuários.
- **Limitação de responsabilidade** e **sem garantia** de resultado/valores de estoque, financeiros ou veterinários calculados pelo sistema (decisões são do Cliente e dos profissionais dele).
- Plataforma pode **suspender** contas por **violação** dos termos, uso abusivo ou risco de segurança.
- **Alterações dos termos** com aviso prévio e novo aceite, **versionadas** (o sistema guarda a versão aceita).
- **Confidencialidade** dos dados do Cliente e **proibição** de acesso por funcionários da Plataforma sem necessidade (acesso do dono ao console deve ser **registrado e justificado**). **[ADVOGADO]**

## 8. O que eu NÃO posso garantir
- Que este rascunho **protege em todos os casos**: leis e decisões da ANPD mudam, e **cada contrato real tem detalhes** (CNPJ, tipo de cliente, valores, foro).
- Que o uso de dados para parceiros **seja permitido** sem ajustes: **depende** da revisão jurídica e de **anonimização real**.
- Por isso: **não venda nem entregue dados a parceiros** antes do parecer do advogado e da implementação técnica da seção 9.

## 9. Checklist técnico/organizacional (o que fazer no sistema)
| Item | Situação |
|---|---|
| Espaço isolado por cliente + regras de acesso | ✔ feito |
| Auditoria de ações por usuário | ✔ feito |
| Cópia mensal permanente do estoque | ✔ feito |
| Registro de consentimento (aceite, data, versão) no painel | ✔ feito (manual, pelo dono) |
| **Aceite dos Termos e da Política no primeiro acesso, dentro do app**, com versão e data guardadas | ⏳ a fazer (depende do texto final do advogado) |
| **Aceite separado** do uso de dados agregados (seção 6) | ⏳ a fazer |
| **Exportar todos os dados de um cliente** (portabilidade) | ⏳ a fazer |
| **Excluir definitivamente um cliente** (com confirmação reforçada) | ✔ feito (botão "Excluir" no painel: só cliente bloqueado, 2 avisos + palavra EXCLUIR) |
| **Aviso automático por e-mail** ao cliente bloqueado por falta de pagamento (e perto do fim dos 12 meses) | ⏳ a fazer (hoje o dono avisa manualmente) |
| **Lista no painel de clientes bloqueados há mais de [11/12] meses** (para o dono decidir a exclusão) | ⏳ a fazer |
| **Mínimo mensal para manter os dados**: registrar no painel de cobrança | ⏳ a fazer (valor a definir) |
| **Relatório agregado/anonimizado** com mínimo de N clientes | ⏳ a fazer (etapa 4/5; só depois do parecer) |
| **Alerta de uso de espaço** (80% / 100%) para o cliente e para o dono | ⏳ a fazer (hoje só aparece em "Ver uso") |
| Cobrança do excedente do Pro | ⏳ etapa 5 |
| **Registro de operações de tratamento** (ROPA) e **RIPD** | ⏳ a fazer com o advogado |
| Contratos/aditivos com subprocessadores (Google, Cloudflare, etc.) | ⏳ verificar os termos aceitos no console |
| Política de incidentes e contato do encarregado publicados | ⏳ a fazer |
| Verificação em dois passos (2FA) para o dono e administradores | ⏳ recomendado |
| Revisão dos acessos de terceiros ao projeto no Google Cloud | ⏳ pendente (há um e-mail de visualizador a confirmar) |
