const Plotly = window.Plotly;
const Papa = window.Papa;

const MONTH_NAMES = { 2: 'Все', 3: 'Март', 4: 'Апрель', 5: 'Май', 6: 'Июнь', 7: 'Июль', 8: 'Август', 9: 'Сентябрь' };

class DataLoader {
    constructor() { this.data = {}; }
    
    async loadAllData() {
        const loadCSV = (path) => new Promise(res => Papa.parse(path, { download: true, header: true, dynamicTyping: true, skipEmptyLines: true, complete: r => res(r.data) }));
        this.data.long = await loadCSV('/data/vi_long_format.csv');
        this.data.viByYear = await loadCSV('/data/dashboard_vi_by_year.csv');
    }
}

async function initDashboard() {
    const loader = new DataLoader();
    
    const geoResponse = await fetch('/data/fires_2005_irk_filtered.geojson');
    
    if (!geoResponse.ok) {
        console.error(`Ошибка загрузки геоданных! Статус: ${geoResponse.status}. URL: ${geoResponse.url}`);
        return;
    }
    
    await loader.loadAllData();
    const geojsonData = await geoResponse.json();
    const allFeatures = geojsonData.features || [];

    const polygonSelect = document.getElementById('select-polygon');
    const indexSelect = document.getElementById('select-active-index');
    const monthSlider = document.getElementById('slider-month');
    const monthLabel = document.getElementById('month-label');
    const vegTypeSelect = document.getElementById('select-veg-type');
    const areaMinInput = document.getElementById('input-area-min');
    const areaMaxInput = document.getElementById('input-area-max');
    const mainResetBtn = document.getElementById('btn-main-reset');
    const toggleBtn = document.getElementById('btn-toggle-theme');

    let currentTheme = 'satellite';
    let selectedFireId = null;
    let selectedIndexName = 'NDVI';
    let activeVegType = null;

    if (polygonSelect) {
        const ids = [...new Set(allFeatures.map(f => f.properties?.fire_id).filter(Boolean))].sort((a,b) => a-b);
        ids.forEach(id => polygonSelect.add(new Option(`Полигон ${id}`, id)));
    }

    const mapDiv = document.getElementById('cnt-map');
    if (mapDiv) {
        Plotly.newPlot(mapDiv, [{
            type: 'scattermapbox',
            lon: [104.28],
            lat: [52.28],
            mode: 'markers',
            marker: { opacity: 0 }
        }], {
            margin: { r: 0, t: 0, l: 0, b: 0 },
            mapbox: {
                style: 'open-street-map',
                center: { lat: 52.28, lon: 104.28 },
                zoom: 6.5
            }
        }, { responsive: true });
    }

    function drawDashboard() {
        const sliderVal = monthSlider ? Number(monthSlider.value) : 2;
        if (monthLabel) monthLabel.textContent = MONTH_NAMES[sliderVal];

        const areaMin = areaMinInput?.value ? Number(areaMinInput.value) : 0;
        const areaMax = areaMaxInput?.value ? Number(areaMaxInput.value) : Infinity;

        const filteredFeatures = allFeatures.filter(f => {
            const p = f.properties || {};
            if (polygonSelect?.value !== 'All' && String(p.fire_id) !== String(polygonSelect.value)) return false;
            if (sliderVal !== 2 && p.dt_first && Number(p.dt_first.split('-')[1]) !== sliderVal) return false;
            return (p.Area || 0) >= areaMin && (p.Area || 0) <= areaMax;
        });

        if (document.getElementById('stat-count')) document.getElementById('stat-count').textContent = filteredFeatures.length;
        if (document.getElementById('stat-duration')) {
            const totalDur = filteredFeatures.reduce((acc, f) => acc + (f.properties?.duration_days || 0), 0);
            document.getElementById('stat-duration').textContent = filteredFeatures.length ? (totalDur / filteredFeatures.length).toFixed(3) : '0.000';
        }

        updateMap(filteredFeatures);
        updateHeatmap(filteredFeatures);
        updateMatrixTable();
        updateCharts();
    }

    function updateMap(features) {
        if (!mapDiv) return;

        const lons = [], lats = [], texts = [];
        features.forEach(f => {
            const p = f.properties || {};
            if (p.lon && p.lat) {
                lons.push(p.lon); lats.push(p.lat);
                texts.push(`<b>ID пожара:</b> ${p.fire_id}<br><b>Площадь:</b> ${p.Area} га`);
            }
        });

        const normalFires = features.filter(f => String(f.properties?.fire_id) !== String(selectedFireId));
        const selectedFires = features.filter(f => String(f.properties?.fire_id) === String(selectedFireId));

        const layers = [];
        if (currentTheme === 'satellite') {
            layers.push({
                sourcetype: 'raster',
                source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                below: ''
            });
        }

        if (normalFires.length) {
            layers.push({
                sourcetype: 'geojson',
                source: { type: 'FeatureCollection', features: normalFires },
                type: 'fill',
                color: 'rgba(255, 147, 7, 0.5)'
            });
        }

        if (selectedFires.length) {
            layers.push({
                sourcetype: 'geojson',
                source: { type: 'FeatureCollection', features: selectedFires },
                type: 'fill',
                color: 'rgba(255, 0, 0, 0.9)'
            });
        }

        let mapCenter = { lat: 52.28, lon: 104.28 };
        let mapZoom = 6.5;

        if (selectedFireId) {
            const target = features.find(f => String(f.properties?.fire_id) === String(selectedFireId));
            if (target && target.properties?.lon && target.properties?.lat) {
                mapCenter = { lat: Number(target.properties.lat), lon: Number(target.properties.lon) };
                mapZoom = 9.5;
            }
        }

        Plotly.react(mapDiv, [{ 
            type: 'scattermapbox', 
            lon: lons.length ? lons : [104.28], 
            lat: lats.length ? lats : [52.28], 
            mode: 'markers', 
            marker: { opacity: 0 }, 
            text: texts, 
            hoverinfo: 'text' 
        }], {
            margin: { r:0, t:0, l:0, b:0 },
            mapbox: { 
                style: currentTheme === 'satellite' ? 'white-bg' : 'carto-darkmatter', 
                center: mapCenter,
                zoom: mapZoom,
                layers: layers
            }
        }, { responsive: true });

        mapDiv.removeAllListeners('plotly_click');
        mapDiv.on('plotly_click', data => {
            const match = data.points?.[0]?.text?.match(/ID пожара:<\/b>\s*(\d+)/);
            if (match) {
                selectedFireId = Number(match[1]);
                if (polygonSelect) polygonSelect.value = selectedFireId;
                drawDashboard();
            }
        });
    }

    function updateHeatmap(features) {
        const heatDiv = document.getElementById('cnt-heat');
        if (!heatDiv) return;

        const sorted = [...features].sort((a,b) => (b.properties?.Area || 0) - (a.properties?.Area || 0));
        const yLabels = ['Длительность (дни)', 'Площадь (тыс. га)', 'Интенсивность'];
        const zValues = [
            sorted.map(f => f.properties?.duration_days || 0), 
            sorted.map(f => (f.properties?.Area || 0) / 1000),
            sorted.map(f => Math.log1p(f.properties?.Area_les || 0))
        ];

        Plotly.newPlot(heatDiv, [{
            z: zValues.length && zValues[0].length ? zValues : [[0], [0], [0]], 
            x: sorted.map(f => String(f.properties?.fire_id)), 
            y: yLabels,
            customdata: yLabels.map(() => sorted.map(f => f.properties?.fire_id)),
            type: 'heatmap', 
            colorscale: 'YlOrRd'
        }], { 
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#aaa', size: 11 },
            margin: { r: 5, t: 5, l: 130, b: 60 }, 
            xaxis: { type: 'category', tickangle: -45, gridcolor: '#222' },
            yaxis: { gridcolor: '#222' }
        }, { responsive: true });

        heatDiv.removeAllListeners('plotly_click');
        heatDiv.on('plotly_click', data => {
            if (data.points?.[0]?.customdata) {
                selectedFireId = Number(data.points[0].customdata);
                if (polygonSelect) polygonSelect.value = selectedFireId;
                drawDashboard();
            }
        });
    }

    function updateMatrixTable() {
        const priorityDiv = document.getElementById('cnt-index-priority');
        if (!priorityDiv) return;

        const vegTypes = ['Поля', 'Пастбища', 'Редколесье', 'Кустарники', 'Хвойный лес', 'Смешанный лес', 'Лиственные'];
        const indicesMatrix = [
            ['NBR', 'NBRPLUS', 'IPVI', 'NDVI', 'SAVI', 'NDWI', 'MSAVI', 'NBR2', 'BAIS2', 'DVI', 'BAI', 'RVI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'GARI', 'ARVI'],
            ['NBR', 'NBRPLUS', 'IPVI', 'NDVI', 'NDWI', 'SAVI', 'MSAVI', 'NBR2', 'DVI', 'BAIS2', 'BAI', 'RVI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'GARI', 'ARVI'],
            ['NBR', 'IPVI', 'NBRPLUS', 'NDVI', 'SAVI', 'MSAVI', 'NDWI', 'NBR2', 'DVI', 'BAIS2', 'RVI', 'BAI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'ARVI', 'GARI'],
            ['NBR', 'IPVI', 'NDVI', 'NBRPLUS', 'NDWI', 'SAVI', 'MSAVI', 'NBR2', 'DVI', 'BAIS2', 'RVI', 'BAI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'ARVI', 'GARI'],
            ['IPVI', 'NDVI', 'NBR', 'NBRPLUS', 'SAVI', 'NDWI', 'MSAVI', 'NBR2', 'DVI', 'BAIS2', 'RVI', 'GCI', 'CIRE', 'BAI', 'PSRI', 'SIPI', 'EVI', 'ARVI', 'GARI'],
            ['NBR', 'IPVI', 'NDVI', 'NBRPLUS', 'NDWI', 'SAVI', 'MSAVI', 'NBR2', 'DVI', 'BAIS2', 'RVI', 'BAI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'ARVI', 'GARI'],
            ['NBR', 'IPVI', 'NDVI', 'NBRPLUS', 'SAVI', 'NDWI', 'MSAVI', 'NBR2', 'DVI', 'BAIS2', 'RVI', 'BAI', 'GCI', 'CIRE', 'PSRI', 'SIPI', 'EVI', 'GARI', 'ARVI']
        ];
        const indexColors = { 'NBR': '#e67326', 'NBRPLUS': '#f28e2b', 'IPVI': '#116644', 'NDVI': '#2bb385', 'SAVI': '#bab0ac', 'NDWI': '#a0cbe8', 'MSAVI': '#d3bda5', 'NBR2': '#9c3a3a', 'BAIS2': '#edc948', 'DVI': '#59a14f', 'BAI': '#f1ce63', 'RVI': '#8cd17d', 'GCI': '#76b7b2', 'CIRE': '#499894', 'PSRI': '#7f7f7f', 'SIPI': '#1f77b4', 'EVI': '#bcbd22', 'GARI': '#98df8a', 'ARVI': '#2ca02c' };

        let html = `<div class="tableau-grid-container"><table class="tableau-matrix"><thead><tr><th class="stub-col">Тип растит.</th>`;
        for (let i = 1; i <= 19; i++) html += `<th>${i}</th>`;
        html += `</tr></thead><tbody>`;

        for (let y = 0; y < vegTypes.length; y++) {
            if (activeVegType && vegTypes[y] !== activeVegType) continue;
            html += `<tr><td class="row-label">${vegTypes[y]}</td>`;
            for (let x = 0; x < 19; x++) {
                const idx = indicesMatrix[y][x];
                const isFaded = (selectedIndexName && idx !== selectedIndexName);
                html += `<td style="background: ${indexColors[idx] || '#666'}; opacity: ${isFaded ? 0.3 : 1}; color: #fff; padding: 5px; cursor: pointer;" class="matrix-cell" data-index="${idx}" data-veg="${vegTypes[y]}">${idx}</td>`;
            }
            html += `</tr>`;
        }

        priorityDiv.innerHTML = html + `</tbody></table></div>`;

        priorityDiv.querySelectorAll('.matrix-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                selectedIndexName = e.target.getAttribute('data-index');
                activeVegType = e.target.getAttribute('data-veg');
                if (indexSelect) indexSelect.value = selectedIndexName;
                if (vegTypeSelect) vegTypeSelect.value = activeVegType;
                drawDashboard();
            });
        });
    }

    function updateCharts() {
        const chartDiv = document.getElementById('cnt-timeline-chart');
        if (!chartDiv) return;

        const viByYearData = loader.data.viByYear || [];
        const years = viByYearData.map(r => Number(r.year)).sort((a,b) => a-b);
        const bgValues = years.map(y => viByYearData.find(r => Number(r.year) === y)?.[`${selectedIndexName}_median`] || null);

        const traces = [{ x: years, y: bgValues, mode: 'lines', name: `Общий тренд ${selectedIndexName}`, line: { color: '#ff9307', dash: 'dot' } }];

        if (selectedFireId) {
            const fireRows = (loader.data.long || []).filter(r => String(r.fire_id) === String(selectedFireId) && r.index === selectedIndexName && r.agg === 'median');
            fireRows.sort((a,b) => Number(a.year) - Number(b.year));
            if (fireRows.length) {
                traces.push({ x: fireRows.map(r => Number(r.year)), y: fireRows.map(r => r.value), mode: 'lines+markers', name: `Пожар ID: ${selectedFireId}`, line: { color: '#2bb385' } });
            }
        }

        let chartTitle = selectedFireId ? `Временные изменения ${selectedIndexName} (Пожар ID: ${selectedFireId})` : `Динамика спектральных индексов по годам (${selectedIndexName})`;

        Plotly.newPlot(chartDiv, traces, { 
            title: { text: chartTitle, font: { color: '#aaa', size: 14 } }, 
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#aaa' }, 
            xaxis: { type: 'category', gridcolor: '#222' },
            yaxis: { gridcolor: '#222' }
        }, { responsive: true });
    }

    if (polygonSelect) polygonSelect.addEventListener('change', e => { selectedFireId = e.target.value === 'All' ? null : Number(e.target.value); drawDashboard(); });
    if (indexSelect) indexSelect.addEventListener('change', e => { selectedIndexName = e.target.value; drawDashboard(); });
    if (monthSlider) monthSlider.addEventListener('input', drawDashboard);
    if (vegTypeSelect) vegTypeSelect.addEventListener('change', e => { activeVegType = e.target.value === 'All' ? null : e.target.value; drawDashboard(); });
    if (areaMinInput) areaMinInput.addEventListener('input', drawDashboard);
    if (areaMaxInput) areaMaxInput.addEventListener('input', drawDashboard);

    if (mainResetBtn) {
        mainResetBtn.addEventListener('click', () => {
            if (polygonSelect) polygonSelect.value = 'All';
            if (indexSelect) indexSelect.value = 'NDVI';
            if (monthSlider) monthSlider.value = 2;
            if (vegTypeSelect) vegTypeSelect.value = 'All';
            [areaMinInput, areaMaxInput].forEach(i => { if (i) i.value = ''; });
            selectedFireId = null; selectedIndexName = 'NDVI'; activeVegType = null;
            drawDashboard();
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            currentTheme = currentTheme === 'satellite' ? 'dark' : 'satellite';
            toggleBtn.textContent = currentTheme === 'satellite' ? 'Тёмная карта' : 'Спутник (Зелень)';
            drawDashboard();
        });
    }

    drawDashboard();
}

window.addEventListener('DOMContentLoaded', initDashboard);