#!/bin/bash
# Para os emuladores sem se auto-matar (filtra a propria linha).
ps -eo pid,args | grep -E "emulators:start|storage-emulator|cloud-firestore-emulator" | grep -v grep | grep -v kill.sh | awk '{print $1}' | xargs -r kill
