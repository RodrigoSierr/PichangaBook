#!/usr/bin/env bash
# Genera los clips demo (15-30 s) de la Bolsa de Suplentes a partir de las fotos
# de acción, con efecto Ken Burns, 480p, H.264 + faststart (streaming progresivo).
# En producción estos clips los graba el jugador y se suben a Cloudinary/S3.
set -euo pipefail
cd "$(dirname "$0")/../public/media"
mkdir -p clips

make_clip () {
  local name="$1" seconds="$2"
  local frames=$((seconds * 25))
  ffmpeg -loglevel error -y -loop 1 -i "player-${name}.jpg" \
    -vf "scale=1920:-2,zoompan=z='min(zoom+0.0009,1.25)':x='iw/2-(iw/zoom/2)+sin(on/40)*25':y='ih/2-(ih/zoom/2)':d=${frames}:s=854x480:fps=25,format=yuv420p" \
    -t "${seconds}" -c:v libx264 -preset veryfast -crf 30 -movflags +faststart -an "clips/${name}.mp4"
  echo "clips/${name}.mp4 (${seconds}s)"
}

make_clip arquero 22
make_clip delantero 18
make_clip defensa 25
make_clip mediocampo 28
