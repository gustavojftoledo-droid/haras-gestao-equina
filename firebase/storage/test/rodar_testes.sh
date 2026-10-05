#!/bin/bash
# Roda os testes das regras no emulador. Pre-requisito: pasta /tmp/st com
#   npm i firebase-tools @firebase/rules-unit-testing firebase
# Nada aqui publica ou mexe no projeto real (projeto demo-haras, so emulador).
AQUI="$(cd "$(dirname "$0")" && pwd)"
ST=${ST:-/tmp/st}
cp "$AQUI/test_storage_rules.mjs" "$ST/"
cd "$ST"
export STORAGE_RULES="$AQUI/../storage.rules"
./node_modules/.bin/firebase emulators:start --only storage,auth --project demo-haras --config "$AQUI/../firebase.json" > "$ST/emul.log" 2>&1 &
sleep 45
node test_storage_rules.mjs
RC=$?
bash "$AQUI/kill.sh"
exit $RC
