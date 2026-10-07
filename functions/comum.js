/* Coisas usadas por todas as funções. */
const MODULOS = ['animais','grupos','nascimentos','manejos','veterinaria','transporte','treinos','estoque','funcionarios','financeiro','usuarios','consultoria'];
const LIMITE_PADRAO_BYTES = 1073741824; // 1 GB
const DONO_EMAIL = 'gustavojftoledo@gmail.com';

/* Planos: o que cada plano libera. 'usuarios' fica em todos para o admin do cliente poder gerir a equipe.
   maxUsuarios 0 = sem limite. Tabela definida pelo dono em 07/10/2026 (ver PLANO_MULTI_CLIENTE.md). */
const MB = 1024 * 1024;
const MODULOS_GRATUITO = ['animais', 'manejos', 'treinos', 'estoque', 'usuarios'];
const MODULOS_BASICO = MODULOS_GRATUITO.concat(['nascimentos', 'veterinaria', 'transporte', 'grupos']);
const PLANOS = {
  gratuito: { modulos: MODULOS_GRATUITO, maxFotos: 1, limiteBytes: 200 * MB, maxUsuarios: 2 },
  basico:   { modulos: MODULOS_BASICO,   maxFotos: 4, limiteBytes: 1024 * MB, maxUsuarios: 5 },
  pro:      { modulos: MODULOS.slice(),  maxFotos: 8, limiteBytes: 5 * 1024 * MB, maxUsuarios: 0 },
};
Object.values(PLANOS).forEach(pl => { pl.modulos = MODULOS.filter(m => pl.modulos.includes(m)); }); // sempre na ordem de MODULOS
const PLANO_PADRAO = 'basico';

/* Novidades liberadas só para alguns clientes ("interruptor por cliente"): lista de chaves curtas guardada em
   clientes/{id}.recursos e copiada para a claim `recursos` das contas do cliente. Chave: letras minúsculas, números e _. */
const RE_RECURSO = /^[a-z][a-z0-9_]{1,29}$/;
const MAX_RECURSOS = 12;
/* Devolve a lista limpa (sem repetidos, só chaves válidas, em ordem). Lança Error se algo for inválido. */
function normalizarRecursos(v){
  if (!Array.isArray(v)) throw new Error('recursos deve ser uma lista');
  const vistos = new Set();
  for (const r of v) {
    if (typeof r !== 'string' || !RE_RECURSO.test(r)) throw new Error('chave de recurso inválida');
    vistos.add(r);
  }
  if (vistos.size > MAX_RECURSOS) throw new Error('recursos demais');
  return [...vistos].sort();
}
function recursosValidos(v){ try { return normalizarRecursos(v); } catch (e) { return []; } } // para ler do banco sem quebrar
function ehPlano(p){ return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PLANOS, p); }
/* Plano desconhecido ou ausente cai no básico. */
function limitesDoPlano(plano){
  const nome = ehPlano(plano) ? plano : PLANO_PADRAO;
  return { plano: nome, ...PLANOS[nome], modulos: PLANOS[nome].modulos.slice() };
}

/* Calcula papel e módulos a partir de um item da usuarios_list. */
function papelEModulos(u){
  const papel = u && u.admin === true ? 'admin' : 'funcionario';
  const modulos = papel === 'admin'
    ? MODULOS.slice()
    : MODULOS.filter(m => u && u.permissoes && u.permissoes[m] && u.permissoes[m].ver === true);
  return { papel, modulos };
}
function normalizarEmail(e){ return typeof e === 'string' ? e.trim().toLowerCase() : ''; }
function mesmaLista(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
module.exports = { MODULOS, LIMITE_PADRAO_BYTES, DONO_EMAIL, PLANOS, PLANO_PADRAO, ehPlano, limitesDoPlano, RE_RECURSO, MAX_RECURSOS, normalizarRecursos, recursosValidos, papelEModulos, normalizarEmail, mesmaLista };
