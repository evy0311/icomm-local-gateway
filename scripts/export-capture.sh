#!/bin/sh
set -eu
umask 077
if [ "$#" -lt 1 ]; then
  echo "Usage: sh scripts/export-capture.sh /private/path/capture.tar.gz [compose options]" >&2
  exit 1
fi
case "$1" in
  /*) destination=$1 ;;
  *) destination="$PWD/$1" ;;
esac
shift
if [ -e "$destination" ]; then echo "Destination already exists; choose a new filename." >&2; exit 1; fi
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
temporary="$destination.tmp"
set -C
trap 'rm -f "$temporary"' EXIT
docker compose "$@" exec -T gateway tar czf - -C /data journal > "$temporary"
mv "$temporary" "$destination"
echo "Capture exported privately. Full mode includes credentials and authenticated packets; exclude exports from public issues and source repositories."
