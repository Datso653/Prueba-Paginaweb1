# CINEMATRIX — IMDb Data Stories

Página estática que procesa los datasets no-comerciales de IMDb directamente en el navegador y muestra 3 métricas con SVG charts a mano (sin librerías).

## Las 3 métricas

1. **El Sweet Spot** — Heatmap de rating promedio cruzando década × duración. Responde: ¿las películas largas son mejor evaluadas? ¿Cambió con las épocas?
2. **Géneros que envejecen bien** — Multi-línea de rating promedio por género a lo largo de las décadas.
3. **Hidden Gems vs Hype** — Scatter rating vs popularidad (votos en escala log), con filtro por género y listado de las top joyas escondidas.

## Estructura

```
.
├── index.html
├── styles.css
├── app.js
├── README.md
└── data/
    ├── title.basics.tsv     (~900 MB descomprimido — añadir manualmente)
    └── title.ratings.tsv    (~25 MB descomprimido — añadir manualmente)
```

## Setup (importante)

Los TSV son demasiado grandes para versionarlos en git. Tenés 3 opciones:

### Opción A — Git LFS (recomendado si vas a usar GitHub Pages)

```bash
git lfs install
git lfs track "data/*.tsv"
git add .gitattributes data/
git commit -m "Add IMDb datasets via LFS"
git push
```

Limitación: GitHub Pages tiene un cap de banda con LFS. Si la página explota mucha, considerá la opción B.

### Opción B — Hosting externo de los TSV

Subí los TSV a S3, Cloudflare R2, o cualquier CDN, y editá `CONFIG.basicsURL` y `CONFIG.ratingsURL` en `app.js` con las URLs completas. Verificá que el host tenga **CORS habilitado**.

### Opción C — Pre-procesar (más rápido para usuarios finales)

Procesá los TSV una vez y exportá un JSON compacto con solo lo que la página necesita. Ahorra ~95% del tamaño:

```bash
# Script de ejemplo en /scripts/preprocess.py (no incluido — fácil de hacer en pandas)
# Output: data/movies.json (~5 MB)
```

Después modificás `app.js` para cargar el JSON en lugar de los TSV.

## Bajar los datos

Una sola vez:

```bash
mkdir -p data && cd data
curl -O https://datasets.imdbws.com/title.basics.tsv.gz
curl -O https://datasets.imdbws.com/title.ratings.tsv.gz
gunzip *.gz
```

Los datos son fresh diariamente. Si querés actualizar, re-corré esto y re-deployá.

## Local dev

Cualquier server estático funciona:

```bash
python3 -m http.server 8000
# o
npx serve .
```

Después abrí `http://localhost:8000`.

## Deploy a GitHub Pages

1. Push del repo a GitHub
2. Settings → Pages → Source: `main` branch, root
3. Esperá ~1 minuto y listo

## Notas técnicas

- **Streaming TSV parser**: `app.js` parsea los TSV línea a línea usando la Streams API, así no carga todo a memoria de golpe. El loader muestra progreso real.
- **Filtros aplicados**: solo películas (`titleType === 'movie'`), no-adult, con al menos 1.000 votos y año entre 1920–2024. Configurable en `CONFIG` arriba de `app.js`.
- **Charts**: SVG generado a mano. Cero dependencias. Pesa nada.

## Licencia / créditos

Datos cortesía de [IMDb](https://www.imdb.com). Uso no-comercial bajo los [términos del dataset](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX).
