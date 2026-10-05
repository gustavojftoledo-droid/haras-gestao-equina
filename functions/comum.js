/* Coisas usadas por todas as funções. */
const MODULOS = ['animais','grupos','nascimentos','manejos','veterinaria','transporte','treinos','estoque','funcionarios','financeiro','usuarios','consultoria'];
const LIMITE_PADRAO_BYTES = 1073741824; // 1 GB
const DONO_EMAIL = 'gustavojftoledo@gmail.com';

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
module.exports = { MODULOS, LIMITE_PADRAO_BYTES, DONO_EMAIL, papelEModulos, normalizarEmail, mesmaLista };
