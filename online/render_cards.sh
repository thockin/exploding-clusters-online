#!/bin/bash

if [ "$#" -eq 0 ]; then
    set -- ../art/*.svg
fi
mkdir -p cards
for f; do
    out=$(basename "$f" | sed 's/\.svg$/.png/')
    echo "$f -> ./cards/$out"
    inkscape \
        --export-area-page \
        --export-dpi=450 \
        --export-background=white \
        -w 1024 \
        "$f" \
        -o "./cards/$out"
done

