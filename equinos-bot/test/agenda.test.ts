/**
 * Testa o cálculo das pendências (agenda.ts) e o texto dos relatórios diários (relatorios.ts).
 * Tudo função pura — sem Firestore, sem Telegram.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeProgramacao,
  dosesPendentesTratamento,
  situacaoEstoque,
  salarioConfirmadoNoMes,
  addDias,
  addMeses,
  diffDias,
} from "../src/agenda.ts";
import {
  montarRelatorioManha,
  montarRelatorioNoite,
  type DadosHaras,
} from "../src/relatorios.ts";

const HOJE = "2026-09-08";

function vazio(): DadosHaras {
  return {
    horses: [],
    manejos: [],
    nascimentos: [],
    tratamentos: [],
    visitas: [],
    visitasRepro: [],
    produtos: [],
    movimentos: [],
    funcionarios: [],
    lancamentos: [],
    transportes: [],
    config: {},
    dispensadas: [],
  };
}

test("datas: addDias / addMeses / diffDias", () => {
  assert.equal(addDias("2026-09-08", 7), "2026-09-15");
  assert.equal(addMeses("2026-01-31", 1), "2026-03-03"); // igual ao Date do app (overflow de fev)
  assert.equal(diffDias("2026-09-15", "2026-09-08"), 7);
  assert.equal(diffDias("2026-09-01", "2026-09-08"), -7);
});

test("computeProgramacao: casco dinâmico (ferrageamento = 30 dias)", () => {
  const horses = [{ id: "h1", nome: "Estrela", situacao: "P", freqcasco: "45" }];
  const manejos = [
    {
      tipo: "Casco",
      data: "2026-08-15",
      subtipoCasco: "Ferrado completo",
      animais: [{ id: "h1", nome: "Estrela", tipo: "Ferrado completo" }],
    },
  ];
  const rows = computeProgramacao(horses, manejos, {}, HOJE);
  const casco = rows.find((r) => r.tipo === "Casco")!;
  assert.equal(casco.proxima, "2026-09-14"); // 15/08 + 30d
  assert.equal(casco.label, "Ferrageamento");
  assert.equal(casco.situacao, "proximo"); // 6 dias à frente
});

test("computeProgramacao: vacina usa freq própria e fica atrasada", () => {
  const horses = [{ id: "h1", nome: "Trovão", situacao: "P" }];
  const manejos = [
    {
      tipo: "Vacina",
      data: "2026-08-01",
      medicamentoNome: "Gripe equina",
      animais: [{ id: "h1", nome: "Trovão" }],
    },
  ];
  const rows = computeProgramacao(horses, manejos, { freqVacinas: { "Gripe equina": 30 } }, HOJE);
  const vac = rows.find((r) => r.tipo === "Vacina")!;
  assert.equal(vac.proxima, "2026-08-31");
  assert.equal(vac.situacao, "atrasado");
});

test("computeProgramacao: animais externos/vendidos/falecidos ficam de fora", () => {
  const horses = [
    { id: "h1", nome: "Externo", situacao: "E", freqcasco: "30" },
    { id: "h2", nome: "Vendido", situacao: "V", freqcasco: "30" },
    { id: "h3", nome: "Morto", situacao: "P", falecimento: "2026-01-01", freqcasco: "30" },
  ];
  assert.equal(computeProgramacao(horses, [], {}, HOJE).length, 0);
});

test("computeProgramacao: tarefa dispensada some", () => {
  const horses = [{ id: "h1", nome: "Estrela", situacao: "P", freqdente: "6" }];
  const manejos = [{ tipo: "Dente", data: "2026-03-08", animais: [{ id: "h1", nome: "Estrela" }] }];
  const semDispensa = computeProgramacao(horses, manejos, {}, HOJE);
  const row = semDispensa.find((r) => r.tipo === "Dente")!;
  const chave = ["h1", "Dente", "Cheque Dental", row.proxima].join("|");
  const comDispensa = computeProgramacao(horses, manejos, {}, HOJE, [chave]);
  assert.equal(semDispensa.some((r) => r.tipo === "Dente"), true);
  assert.equal(comDispensa.some((r) => r.tipo === "Dente"), false);
});

test("dosesPendentesTratamento: pula concluídas e excluídas", () => {
  const t = {
    dataInicio: "2026-09-06",
    diasTratamento: 3,
    intervaloDias: 1,
    periodos: { manha: true, noite: true },
    doseConcluidas: ["2026-09-06|manha"],
    doseExcluidas: ["2026-09-06|noite"],
  };
  const doses = dosesPendentesTratamento(t, HOJE);
  assert.equal(doses.length, 4); // 3 dias x 2 períodos = 6, menos 2
  assert.deepEqual(doses[0], { data: "2026-09-07", periodo: "manha" });
});

test("situacaoEstoque: mínimo fixo e zerado", () => {
  assert.equal(situacaoEstoque({ id: "p1", quantidade: 0 }, [], HOJE), "zerado");
  assert.equal(situacaoEstoque({ id: "p1", quantidade: 2, minimo: 5 }, [], HOJE), "perto");
  assert.equal(situacaoEstoque({ id: "p1", quantidade: 10, minimo: 5 }, [], HOJE), null);
});

test("salarioConfirmadoNoMes", () => {
  const lanc = [{ origemFuncionarioId: "f1", categoria: "Salário", data: "2026-09-05" }];
  assert.equal(salarioConfirmadoNoMes(lanc, "f1", "2026-09"), true);
  assert.equal(salarioConfirmadoNoMes(lanc, "f1", "2026-08"), false);
  assert.equal(salarioConfirmadoNoMes(lanc, "f2", "2026-09"), false);
});

test("relatório da manhã: separa papéis e blocos; casco só no ferrador+adm", () => {
  const d = vazio();
  d.horses = [
    { id: "h1", nome: "Estrela", situacao: "P" },
    { id: "h2", nome: "Trovão", situacao: "P", freqvermifugo: "3" },
  ];
  d.manejos = [
    {
      tipo: "Casco",
      data: "2026-08-25",
      animais: [{ id: "h1", nome: "Estrela", tipo: "Casqueado" }],
    },
    { tipo: "Vermífugo", data: "2026-06-10", animais: [{ id: "h2", nome: "Trovão" }] },
  ];
  const txt = montarRelatorioManha(d, HOJE);
  assert.match(txt, /👤 ADM/);
  assert.match(txt, /🩺 Veterinário/);
  assert.match(txt, /🔨 Ferrador/);
  // casco (casqueamento de 60d a partir de 25/08 -> 24/10, fora do horizonte de 7d) NÃO deve aparecer
  assert.doesNotMatch(txt, /Casqueamento/);
  // vermífugo atrasado aparece pro vet
  assert.match(txt, /Desparasita|Vermífugo/);
});

test("relatório da manhã: lavado pendente e prenhez a confirmar entram em Reprodução", () => {
  const d = vazio();
  d.nascimentos = [
    {
      id: "n1",
      matriz: "Doadora",
      pai: "Garanhão",
      transferenciaEmbriao: true,
      confirm: "N",
      dataColetaEmbriao: "2026-09-05",
    },
    {
      id: "n2",
      matriz: "Égua Natural",
      pai: "Garanhão",
      transferenciaEmbriao: false,
      confirm: "N",
      prenhezConfirmada: "N",
      datacob: "2026-08-10",
    },
  ];
  const txt = montarRelatorioManha(d, HOJE);
  assert.match(txt, /Lavado pendente — Doadora/);
  assert.match(txt, /Confirmar prenhez — Égua Natural/);
});

test("relatório da noite: manejos por tipo, casco por subtipo", () => {
  const d = vazio();
  d.manejos = [
    {
      tipo: "Casco",
      data: HOJE,
      animais: [
        { id: "h1", nome: "A", tipo: "Ferrado completo" },
        { id: "h2", nome: "B", tipo: "Casqueado" },
        { id: "h3", nome: "C", tipo: "Ferrado completo" },
      ],
    },
    { tipo: "Dente", data: HOJE, animais: [{ id: "h4", nome: "D" }] },
    { tipo: "Vacina", data: HOJE, medicamentoNome: "Gripe", animais: [{ id: "h5", nome: "E" }] },
  ];
  const txt = montarRelatorioNoite(d, HOJE);
  assert.match(txt, /Ferrado completo: A, C/);
  assert.match(txt, /Casqueado: B/);
  assert.match(txt, /Dente.*D/);
  assert.match(txt, /Vacina.*\(Gripe\).*E/);
});

test("relatório da noite: reprodução (cobertura, lavado, prenhez)", () => {
  const d = vazio();
  d.nascimentos = [
    { id: "n1", matriz: "M1", pai: "P1", datacob: HOJE, transferenciaEmbriao: true },
    { id: "n2", matriz: "M2", pai: "P2", lavado: "NEG", lavadoData: HOJE },
    { id: "n3", matriz: "M3", receptora: "R3", transferenciaEmbriao: true, prenhezHistorico: [HOJE] },
  ];
  const txt = montarRelatorioNoite(d, HOJE);
  assert.match(txt, /Cobertura — M1 × P1 \(transferência de embrião\)/);
  assert.match(txt, /Lavado negativo ✕ — M2 \(cobertura encerrada\)/);
  assert.match(txt, /Prenhez confirmada — R3/);
});

test("relatório da noite: dia sem nada", () => {
  assert.match(montarRelatorioNoite(vazio(), HOJE), /Nenhum registro lançado hoje/);
});
