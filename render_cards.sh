#!/bin/bash

if [ "$#" -eq 0 ]; then
    set -- ../art/*.svg
fi
outdir="public/art"
mkdir -p "$outdir"
for f; do
    outfile=$(basename "$f" | sed 's/\.svg$/.png/')
    echo "$f -> ./$outdir/$outfile"

    # Render with no background...
    inkscape \
        --export-area-page \
        --export-dpi=450 \
        --export-background-opacity=0 \
        -w 1024 \
        "$f" \
        -o "/tmp/tmp_$outfile"
    # ...then add a background with rounded corners...
    convert \
        card_bg.png \
        +set date:timestamp \
        -gravity center \
        -compose Atop \
        "/tmp/tmp_$outfile" \
        -composite \
        "./$outdir/$outfile"
    # ...then add metadata.
    exiftool \
        -copyright="Tim Hockin, 2025" \
        -overwrite_original_in_place \
        "./$outdir/$outfile"
done

