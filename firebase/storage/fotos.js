/* =====================================================================
   fotos.js - fotos dos animais no Firebase Storage (sem dependencias)
   ---------------------------------------------------------------------
   Pensado para ser COLADO dentro do app (arquivo unico). Tambem roda no
   Node (module.exports no fim) para testar a logica pura.

   Precisa, no app, do SDK de Storage na versao "compat" (a mesma 10.14.1
   que o app ja usa):
     <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js"></script>
   e de:  const storage = firebase.storage();

   "escopo" = de quem e a foto:
     - null / '' / 'haras-original'  -> haras original (sem claim tenantId)
     - 'cli-a' (string) ou {tenantId:'cli-a'} -> cliente (claim tenantId)
   No app: escopo = TENANT_ID (que e null para o haras original).

   No cadastro do animal ficam SO textos pequenos:
     h.fotoUrl      -> endereco da foto (ou o 'data:image' antigo)
     h.fotoMiniUrl  -> endereco da miniatura
     h.fotoPath     -> caminho no Storage (usado para apagar)
     h.fotoMiniPath -> caminho da miniatura
   ===================================================================== */
(function (raiz) {
  'use strict';

  var MAX_DIM = 900;          // lado maior da foto reduzida (px)
  var QUALIDADE = 0.72;       // qualidade JPEG da foto
  var MAX_DIM_MINI = 240;     // lado maior da miniatura (px)
  var QUALIDADE_MINI = 0.7;   // qualidade JPEG da miniatura
  var LIMITE_BYTES = 400 * 1024; // mesmo limite das regras do Storage
  var CACHE = 'public,max-age=31536000'; // 1 ano: nome muda se a foto mudar

  /* ---------------- LOGICA PURA (testada no Node) ---------------- */

  // Calcula o tamanho novo mantendo a proporcao. Nunca aumenta a imagem.
  function calcularDimensoes(largura, altura, maximo) {
    maximo = maximo || MAX_DIM;
    var w = Math.round(largura), h = Math.round(altura);
    if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
    if (w >= h && w > maximo) { h = Math.round(h * maximo / w); w = maximo; }
    else if (h > w && h > maximo) { w = Math.round(w * maximo / h); h = maximo; }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  // Normaliza o escopo: devolve {tipo:'cliente', tenantId} ou {tipo:'original'}.
  function normalizarEscopo(escopo) {
    var t = (escopo && typeof escopo === 'object') ? escopo.tenantId : escopo;
    if (t === null || t === undefined || t === '' || t === 'haras-original') return { tipo: 'original' };
    if (typeof t !== 'string' || !/^[a-z0-9_-]{3,40}$/i.test(t)) throw new Error('escopo invalido');
    return { tipo: 'cliente', tenantId: t };
  }

  // Deixa so letras, numeros, "_" e "-" (evita "/" e ".." em caminhos).
  function limparId(texto) {
    var s = String(texto === undefined || texto === null ? '' : texto).replace(/[^A-Za-z0-9_-]/g, '_');
    if (!s) throw new Error('id do animal vazio');
    return s.slice(0, 80);
  }

  // Caminho da pasta do animal conforme o escopo (igual ao storage.rules).
  function pastaFotos(escopo, animalId) {
    var e = normalizarEscopo(escopo);
    var base = e.tipo === 'cliente' ? 'tenants/' + e.tenantId + '/fotos/' : 'haras-original/fotos/';
    return base + limparId(animalId) + '/';
  }

  function caminhoFoto(escopo, animalId, arquivo) {
    if (!/^[A-Za-z0-9_.-]+$/.test(arquivo) || arquivo.indexOf('..') >= 0) throw new Error('nome de arquivo invalido');
    return pastaFotos(escopo, animalId) + arquivo;
  }

  // Resumo (hash) rapido FNV-1a de 32 bits sobre bytes. Serve so para dar nome unico.
  function hashBytes(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // Nomes: "<tempo>-<hash>.jpg" e "<tempo>-<hash>_min.jpg". Nome novo a cada foto
  // => o cache de 1 ano nunca mostra foto velha.
  function nomesArquivo(bytes, agora, ext) {
    ext = ext || 'jpg';
    var base = (agora === undefined ? Date.now() : agora).toString(36) + '-' + hashBytes(bytes);
    return { foto: base + '.' + ext, miniatura: base + '_min.' + ext };
  }

  // Valores aceitos no campo da foto: base64 antigo OU endereco https.
  function ehDataImage(v) { return typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(v); }
  function ehFotoValida(v) { return ehDataImage(v) || (typeof v === 'string' && /^https:\/\//i.test(v)); }

  // Converte 'data:image/...;base64,XXXX' em {tipo, bytes}. (usa atob: navegador e Node 16+)
  function dataUrlParaBytes(dataUrl) {
    var m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(dataUrl || '');
    if (!m) throw new Error('nao e data:image');
    var bin = atob(m[2]), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { tipo: m[1].toLowerCase(), bytes: out };
  }

  // Extrai o caminho do Storage de uma URL de download (para apagar quando
  // so temos a URL). Devolve '' se nao reconhecer.
  function caminhoDeUrl(url) {
    var m = /\/o\/([^?]+)/.exec(url || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
  }

  function extDoTipo(tipo) { return tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'; }

  /* ------------- PARTES QUE PRECISAM DE NAVEGADOR (canvas) -------------
     SEM TESTE automatico: dependem de canvas/Image/Blob reais. */

  function carregarImagem(arquivo) {
    return new Promise(function (ok, erro) {
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); erro(new Error('nao consegui ler a imagem')); };
      img.src = url;
    });
  }

  // Reduz para no maximo "maximo" px e devolve um Blob JPEG.
  function reduzirImagem(arquivo, maximo, qualidade) {
    return carregarImagem(arquivo).then(function (img) {
      var d = calcularDimensoes(img.naturalWidth || img.width, img.naturalHeight || img.height, maximo || MAX_DIM);
      var c = document.createElement('canvas');
      c.width = d.w; c.height = d.h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.w, d.h); // PNG com fundo transparente vira branco
      ctx.drawImage(img, 0, 0, d.w, d.h);
      return new Promise(function (ok, erro) {
        c.toBlob(function (b) { b ? ok(b) : erro(new Error('falha ao gerar JPEG')); }, 'image/jpeg', qualidade || QUALIDADE);
      });
    });
  }

  function gerarMiniatura(arquivo) { return reduzirImagem(arquivo, MAX_DIM_MINI, QUALIDADE_MINI); }

  function blobParaBytes(blob) {
    return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /* ---------------- ENVIO / REMOCAO (usam o Storage) ---------------- */

  // Sobe um Blob ja pronto (precisa do Storage compat).
  function subirBlob(storage, caminho, blob, tipo) {
    var r = storage.ref(caminho);
    return r.put(blob, { contentType: tipo || blob.type || 'image/jpeg', cacheControl: CACHE })
      .then(function () { return r.getDownloadURL(); })
      .then(function (url) { return { url: url, path: caminho }; });
  }

  // Reduz, gera miniatura, sobe as duas. Devolve {url, urlMiniatura, bytes, path, pathMiniatura}.
  function enviarFoto(storage, escopo, animalId, arquivo) {
    pastaFotos(escopo, animalId); // valida escopo/id antes de gastar tempo
    return Promise.all([reduzirImagem(arquivo, MAX_DIM, QUALIDADE), gerarMiniatura(arquivo)]).then(function (par) {
      var foto = par[0], mini = par[1];
      if (foto.size > LIMITE_BYTES) throw new Error('foto reduzida ainda passa de 400 KB');
      return blobParaBytes(foto).then(function (bytes) {
        var n = nomesArquivo(bytes, Date.now());
        return Promise.all([
          subirBlob(storage, caminhoFoto(escopo, animalId, n.foto), foto, 'image/jpeg'),
          subirBlob(storage, caminhoFoto(escopo, animalId, n.miniatura), mini, 'image/jpeg')
        ]).then(function (r) {
          return { url: r[0].url, urlMiniatura: r[1].url, bytes: foto.size, path: r[0].path, pathMiniatura: r[1].path };
        });
      });
    });
  }

  // Apaga foto e miniatura. Aceita o animal (h) ou {fotoPath, fotoMiniPath}.
  // Se nao existir mais no Storage, nao e erro.
  function removerFoto(storage, h) {
    var caminhos = [h && h.fotoPath || caminhoDeUrl(h && h.fotoUrl), h && h.fotoMiniPath || caminhoDeUrl(h && h.fotoMiniUrl)]
      .filter(function (p) { return p; });
    return Promise.all(caminhos.map(function (p) {
      return storage.ref(p).delete().catch(function (e) {
        if (e && e.code === 'storage/object-not-found') return;
        throw e;
      });
    })).then(function () { return caminhos.length; });
  }

  // Converte a foto base64 antiga de UM animal em arquivo do Storage.
  // Seguranca: o base64 so e trocado DEPOIS que o upload deu certo. Se der erro,
  // "h" fica intacto. Depois de converter, o app precisa SALVAR a lista de animais.
  // Devolve true se converteu, false se nao havia nada a converter.
  function migrarBase64ParaStorage(storage, escopo, h) {
    if (!h || !ehDataImage(h.fotoUrl)) return Promise.resolve(false);
    var dados = dataUrlParaBytes(h.fotoUrl);
    var blob = new Blob([dados.bytes], { type: dados.tipo });
    var n = nomesArquivo(dados.bytes, Date.now(), extDoTipo(dados.tipo));
    var pFoto = caminhoFoto(escopo, h.id, n.foto);
    var pMini = caminhoFoto(escopo, h.id, n.miniatura);
    // Se o base64 antigo passar de 400 KB, reduz antes (precisa de canvas).
    var preparo = blob.size <= LIMITE_BYTES ? Promise.resolve(blob) : reduzirImagem(blob, MAX_DIM, QUALIDADE);
    return preparo.then(function (b) {
      var tipo = b.type || dados.tipo;
      return subirBlob(storage, pFoto, b, tipo).then(function (f) {
        // Miniatura e opcional na migracao: se falhar, segue so com a foto.
        return gerarMiniatura(blob).then(function (m) { return subirBlob(storage, pMini, m, 'image/jpeg'); })
          .catch(function () { return null; })
          .then(function (m) { return { f: f, m: m }; });
      });
    }).then(function (r) {
      // Upload confirmado: so agora troca o base64 pela URL.
      h.fotoUrl = r.f.url; h.fotoPath = r.f.path;
      if (r.m) { h.fotoMiniUrl = r.m.url; h.fotoMiniPath = r.m.path; }
      return true;
    });
  }


  // ---------------- ARQUIVOS DE EXAME (PDF, zip, imagem) ----------------
  var LIMITE_ARQUIVO_BYTES = 10 * 1024 * 1024; // mesmo limite das regras do Storage
  function pastaExames(escopo, animalId) {
    var e = normalizarEscopo(escopo);
    var base = e.tipo === 'cliente' ? 'tenants/' + e.tenantId + '/exames/' : 'haras-original/exames/';
    return base + limparId(animalId) + '/';
  }
  function nomeSeguro(nome) { return String(nome || 'arquivo').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'arquivo'; }
  // Sobe o arquivo ORIGINAL (sem reduzir) para a pasta de exames do animal. Devolve {url, path, tipo, bytes}.
  function enviarArquivo(storage, escopo, animalId, arquivo) {
    if (!arquivo) return Promise.reject(new Error('sem arquivo'));
    if (arquivo.size > LIMITE_ARQUIVO_BYTES) return Promise.reject(new Error('arquivo passa de 10 MB'));
    var tipo = arquivo.type || 'application/octet-stream';
    var caminho = pastaExames(escopo, animalId) + Date.now().toString(36) + '-' + nomeSeguro(arquivo.name);
    return subirBlob(storage, caminho, arquivo, tipo).then(function (r) { return { url: r.url, path: r.path, tipo: tipo, bytes: arquivo.size }; });
  }
  function removerArquivo(storage, caminho) {
    if (!caminho) return Promise.resolve(false);
    return storage.ref(caminho).delete().then(function () { return true; }, function (e) { if (e && e.code === 'storage/object-not-found') return false; throw e; });
  }


  // Sobe um Blob JPEG ja pronto como miniatura (ex.: 1a pagina de um PDF). Devolve {url, path}.
  function enviarMiniaturaBlob(storage, escopo, animalId, blob) {
    pastaFotos(escopo, animalId);
    return blobParaBytes(blob).then(function (bytes) {
      var n = nomesArquivo(bytes, Date.now());
      return subirBlob(storage, caminhoFoto(escopo, animalId, n.miniatura), blob, 'image/jpeg');
    });
  }

  var API = {
    MAX_DIM: MAX_DIM, QUALIDADE: QUALIDADE, MAX_DIM_MINI: MAX_DIM_MINI, LIMITE_BYTES: LIMITE_BYTES, CACHE: CACHE,
    calcularDimensoes: calcularDimensoes, normalizarEscopo: normalizarEscopo, limparId: limparId,
    pastaFotos: pastaFotos, caminhoFoto: caminhoFoto, hashBytes: hashBytes, nomesArquivo: nomesArquivo,
    ehDataImage: ehDataImage, ehFotoValida: ehFotoValida, dataUrlParaBytes: dataUrlParaBytes, caminhoDeUrl: caminhoDeUrl,
    reduzirImagem: reduzirImagem, gerarMiniatura: gerarMiniatura,
    enviarFoto: enviarFoto, removerFoto: removerFoto, migrarBase64ParaStorage: migrarBase64ParaStorage,
    enviarArquivo: enviarArquivo, removerArquivo: removerArquivo, enviarMiniaturaBlob: enviarMiniaturaBlob, pastaExames: pastaExames, LIMITE_ARQUIVO_BYTES: LIMITE_ARQUIVO_BYTES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else raiz.Fotos = API;
})(typeof window !== 'undefined' ? window : this);
