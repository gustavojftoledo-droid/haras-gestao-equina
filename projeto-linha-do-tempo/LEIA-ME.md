# Divisão da Linha do Tempo por animal — projeto e protótipo (NÃO publicado)

Preparado em segundo plano em 06/10/2026. **Nada disto está no app de teste nem no app em uso.**

- `PROJETO_DIVISAO_LINHA_DO_TEMPO.md` — decisão de formato, migração, reversão, riscos e pontos do código.
- `prototipo_app_preview.html.txt` — protótipo (cópia do app de teste de 06/10 com a mudança). Salvo como `.txt` e com a migração automática DESLIGADA (`AREG_MIGRACAO_AUTOMATICA = false`) para ninguém abrir por engano e migrar o banco real. Base desatualizada: precisa ser portado para a versão atual antes de usar.
- `testes/pw_linha_do_tempo_por_animal.js` — 60 verificações no navegador (Firestore de mentira).
- `../firebase/test_rules_areg.mjs` — regras do Firestore no emulador (24 verificações).

Risco principal: o app de teste e o app em uso compartilham o banco. A divisão só deve ir ao ar nos dois ao mesmo tempo, com backup e migração ligada só nessa hora.
