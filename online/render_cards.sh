#!/bin/bash

if [ "$#" -eq 0 ]; then
    set -- ../art/*.svg
fi
mkdir -p cards
for f; do
    out=$(basename "$f" | sed 's/\.svg$/.png/')
    echo "$f -> ./cards/$out"

    # Render with no background...
    inkscape \
        --export-area-page \
        --export-dpi=450 \
        --export-background-opacity=0 \
        -w 1024 \
        "$f" \
        -o "/tmp/tmp_$out"
    # ...then add a background with rounded corners.
    convert \
        card_bg.png \
        +set date:timestamp \
        -gravity center \
        -compose Atop \
        "/tmp/tmp_$out" \
        -composite \
        "./cards/$out"
done

