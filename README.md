# CINEMATRIX — IMDb Data Stories

Página estática con 3 métricas sobre el dataset abierto de IMDb. Sin librerías, charts SVG hechos a mano, dark mode estilo cinema.

## Setup en 3 pasos

### 0. (Opcional) Probar ya mismo con el dataset de muestra

El repo viene con un `data/movies.json` precargado con **205 películas conocidas** (clásicos, hits, joyas). Sirve para verificar que la web funciona antes de generar el dataset completo. Saltá al paso 3 y deployalo así nomás, o probalo localmente con:

```bash
python3 -m http.server 8000
```

Cuando quieras los datos reales (~35.000 películas), seguí los pasos 1 y 2.

### 1. Generar el dataset completo (una sola vez)

Abrí el notebook `preprocess.ipynb` en Jupyter o en Google Colab y corré todas las celdas (Run All). Hace todo solo:

- Descarga `title.basics.tsv.gz` y `title.ratings.tsv.gz` desde IMDb (~210 MB)
- Filtra películas con ≥1000 votos entre 1920-2024
- Exporta dos archivos en `data/`:
  - `movies.json` — ~3-5 MB
  - `movies.json.gz` — ~1-1.5 MB (3x más chico, gracias gzip)

Tarda 1-3 minutos. Si querés más o menos pelis, ajustá `MIN_VOTES` en la celda de config.

### 2. Estructura del repo

```
tu-repo/
├── index.html
├── styles.css
├── app.js
├── preprocess.ipynb       ← notebook que genera el dataset
└── data/
    └── movies.json.gz     ← lo que generaste en el paso 1 (subí solo este)
```

**Subí solo el `.gz`**. El frontend lo detecta automáticamente y lo descomprime al vuelo en el navegador con `DecompressionStream` (API nativa). Si por alguna razón querés el JSON sin comprimir, también funciona.

### 3. Deploy a GitHub Pages

```bash
git add .
git commit -m "Initial commit"
git push
```

Después: Settings → Pages → Source: `main` branch → root → Save.

En 1-2 minutos tu sitio está online en `https://<usuario>.github.io/<repo>/`.

## Las 3 métricas

1. **El Sweet Spot** — Heatmap de rating promedio cruzando **década × duración**. Responde si las películas largas son mejor evaluadas y cómo cambió con las épocas.
2. **Géneros que envejecen bien** — Líneas de rating promedio por género a lo largo de las décadas. Hover en la leyenda para aislar uno.
3. **Hidden Gems vs Hype** — Scatter de rating vs votos (escala log) con filtro por género. Las joyas escondidas se destacan en naranja arriba a la izquierda; los hits masivos en rojo a la derecha.

## ¿Cómo elige el frontend qué archivo cargar?

`app.js` prueba en este orden:

1. `data/movies.json.gz` — si existe, lo descomprime
2. `data/movies.json` — fallback

Tenés que subir **al menos uno**. Si tenés los dos, gana el `.gz`.

## Configuración del dataset

En la celda 1 del notebook podés tocar:

```python
MIN_VOTES = 1000          # bajalo → más pelis, archivo más grande
MIN_YEAR = 1920
MAX_YEAR = 2024
TITLE_TYPES = {'movie'}   # podés agregar 'tvSeries', 'tvMovie', etc.
```

Referencia aproximada del tamaño final:

| MIN_VOTES | Pelis        | movies.json | movies.json.gz |
|-----------|--------------|-------------|----------------|
| 5000      | ~12.000      | ~1.5 MB     | ~500 KB        |
| 1000      | ~35.000      | ~4 MB       | ~1.3 MB        |
| 100       | ~150.000     | ~18 MB      | ~6 MB          |

## Dev local

```bash
python3 -m http.server 8000
# abrí http://localhost:8000
```

> No abras `index.html` con doble click. El `fetch()` a `data/` necesita un servidor HTTP, si no te tira error de CORS.

## Stack

HTML + CSS + vanilla JS. Cero dependencias en el frontend. El notebook usa `pandas`, `requests`, `tqdm`, `matplotlib`.

## Licencia / créditos

Datos de [IMDb](https://www.imdb.com) bajo [licencia no-comercial](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX).
