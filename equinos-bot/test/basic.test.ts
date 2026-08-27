import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDataBR,
  fmtDataBR,
  titleCase,
  norm,
  proximoCodigo,
  ensureExternalAnimal,
  montarAnimal,
  montarManejo,
  registrarAux,
  auditEntrada,
  acharAnimal,
  type Horse,
} from "../src/domain.ts";
import { _toValue, _fromValue } from "../src/firestore.ts";

test("parseDataBR aceita formatos e rejeita lixo", () => {
  assert.equal(parseDataBR("25/12/2026"), "2026-12-25");
  assert.equal(parseDataBR("5-3-26"), "2026-03-05");
  assert.equal(parseDataBR("2026-01-09"), "2026-01-09");
  assert.equal(parseDataBR("31/02/2026"), null);
  assert.equal(parseDataBR("abc"), null);
  assert.equal(parseDataBR("13/13/2026"), null);
});

test("fmtDataBR", () => {
  assert.equal(fmtDataBR("2026-12-25"), "25/12/2026");
});

test("titleCase e norm", () => {
  assert.equal(titleCase("joão da SILVA"), "João Da Silva");
  assert.equal(norm("Água Comprida"), "agua comprida");
});

test("proximoCodigo", () => {
  assert.equal(proximoCodigo([{ codigo: "0007" } as Horse, { codigo: "0012" } as Horse]), "0013");
  assert.equal(proximoCodigo([]), "0001");
});

test("ensureExternalAnimal cria externo e promove a interno", () => {
  const horses: Horse[] = [];
  const a = ensureExternalAnimal(horses, "vento forte", "MASCULINO");
  assert.equal(a.criado, true);
  assert.equal(a.horse.situacao, "E");
  assert.equal(horses.length, 1);
  // idempotente
  const b = ensureExternalAnimal(horses, "Vento Forte", "MASCULINO");
  assert.equal(b.criado, false);
  assert.equal(horses.length, 1);
  // promove
  const c = ensureExternalAnimal(horses, "vento forte", "MASCULINO", true);
  assert.equal(c.horse.situacao, "P");
  assert.equal(c.horse.categoria, "Receptora");
});

test("montarAnimal herda avós dos pais já cadastrados", () => {
  const horses: Horse[] = [];
  ensureExternalAnimal(horses, "Trovão", "MASCULINO");
  horses[0].pai = "Raio";
  horses[0].mae = "Nuvem";
  const animal = montarAnimal(horses, { nome: "potro teste", sexo: "MASCULINO", pai: "trovão" });
  assert.equal(animal.nome, "Potro Teste");
  assert.equal(animal.situacao, "P");
  assert.equal(animal.pai, "Trovão");
  assert.equal(animal.avopat, "Raio");
  assert.equal(animal.avopatmat, "Nuvem");
  assert.ok(animal.criadoEm.match(/^\d{4}-\d{2}-\d{2}$/));
});

test("montarManejo — Casco e Dente", () => {
  const casco = montarManejo({
    tipo: "Casco",
    data: "2026-08-01",
    animais: [{ id: "h_1", nome: "Estrela" }],
    subtipoCasco: "Ferrado completo",
  });
  assert.equal(casco.subtipoCasco, "Ferrado completo");
  assert.equal(casco.animais[0].tipo, "Ferrado completo");
  assert.equal(casco.valor, null);
  assert.equal(casco.ferrador, "");

  const dente = montarManejo({ tipo: "Dente", data: "2026-08-01", animais: [{ id: "h_1", nome: "Estrela" }] });
  assert.equal(dente.valor, null);
  assert.equal((dente as any).subtipoCasco, undefined);
});

test("registrarAux só adiciona valores novos", () => {
  const aux: Record<string, string[]> = { pelagem: ["Tordilho"] };
  const animal = montarAnimal([], {
    nome: "X",
    sexo: "FEMININO",
    pelagem: "tordilho",
    categoria: "Matriz",
    proprietario: "Paulo Toledo",
  });
  const mudou = registrarAux(aux, animal);
  assert.equal(mudou, true);
  assert.deepEqual(aux.pelagem, ["Tordilho"]); // tordilho já existe (case-insensitive)
  assert.deepEqual(aux.categoria, ["Matriz"]);
  assert.deepEqual(aux.proprietario, ["Paulo Toledo"]);
});

test("auditEntrada limita o tamanho", () => {
  let log: any[] = [];
  for (let i = 0; i < 1600; i++) log = auditEntrada(log, "inclusao", "Animais", "a" + i, "h_" + i);
  assert.equal(log.length, 1500);
  assert.equal(log[log.length - 1].usuario, "Chatbot (Telegram)");
});

test("acharAnimal ignora acento e caixa", () => {
  const horses = [{ id: "h_1", nome: "Órion" } as Horse];
  assert.equal(acharAnimal(horses, "orion")?.id, "h_1");
});

test("conversão Firestore Value ida e volta", () => {
  const original = [
    { id: "h_1", nome: "Estrela", doador: true, valor: 12.5, qtd: 3, obs: "", tags: ["a", "b"], meta: {} },
    { id: "h_2", nome: "Vento", filhos: [] },
  ];
  const v = _toValue(original);
  const back = _fromValue(v);
  assert.deepEqual(back, original);
});

test("toValue nunca emite undefined (Firestore rejeita)", () => {
  const v = _toValue({ a: undefined, b: 1, c: NaN });
  const json = JSON.stringify(v);
  assert.ok(!json.includes("undefined"));
  assert.deepEqual(_fromValue(v), { b: 1, c: null });
});
