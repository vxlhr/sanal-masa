#!/usr/bin/env bash
# Mac / Linux: masayi baslatir ve internete acar (Cloudflare, hesap gerekmez).
exec "$(dirname "$0")/baslat.sh" --internet "$@"
