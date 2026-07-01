import Plotly from 'plotly.js-dist-min';
import Papa from 'papaparse';

const MONTH_NAMES = {
    2: 'Все', 3: 'Март', 4: 'Апрель', 5: 'Май', 6: 'Июнь',
    7: 'Июль', 8: 'Август', 9: 'Сентябрь'
};

class DataLoader {
    constructor() {
        this.data = { wide: null, long: null, viByYear: null, ndviAreas: null, metadata: null };
        this.isLoaded = false;
    }

    async loadAllData() {
        try {
            const parser = typeof Papa !== 'undefined' ? Papa : window.Papa;
            const [wide, long, viByYear, ndviAreas, metadata] = await Promise.all([
                this.loadCSV('/data/vi_wide_format.csv', parser),
                this.loadCSV('/data/vi_long_format.csv', parser),
                this.loadCSV('/data/dashboard_vi_by_year.csv', parser),
                this.loadCSV('/data/dashboard_ndvi_areas.csv', parser),
                this.loadCSV('/data/dashboard_fires_metadata.csv', parser)
            ]);
            this.data.wide = wide;
            this.data.long = long;
            this.data.viByYear = viByYear;
            this.data.metadata = metadata;
            this.isLoaded = true;
            return this.data;
        } catch (error) {
            throw error;
        }
    }

    loadCSV(filePath, parser) {
        return new Promise((resolve, reject) => {
            if (!parser) return reject(new Error('Papa Parse не найден.'));
            parser.parse(filePath, {
                download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
                complete: (res) => res.errors?.length ? reject(res.errors) : resolve(res.data),
                error: (err) => reject(err)
            });
        });
    }
}

class DataFilter {
    constructor(dataLoader) {
        this.dataLoader = dataLoader;
    }

    prepareMultiLineNDVI(fireId, selectedIndex = 'NDVI') {
        const viByYearData = this.dataLoader.data.viByYear || [];
        const longData = this.dataLoader.data.long || [];
        const bgYears = viByYearData.map(r => Number(r.year)).sort((a, b) => a - b);
        
        const targetIndexField = viByYearData[0] && `${selectedIndex}_median` in viByYearData[0] 
            ? `${selectedIndex}_median` : 'NDVI_median';

        const bgNDVI = bgYears.map(y => {
            const match = viByYearData.find(r => Number(r.year) === y);
            return match ? match[targetIndexField] : null;
        });

        const traces = [{
            x: bgYears, y: bgNDVI, mode: 'lines',
            name: `Общие изменения ${selectedIndex}`,
            line: { color: '#ff9307', width: 2, dash: 'dot' }
        }];

        if (fireId) {
            const fireRows = longData.filter(r => String(r.fire_id) === String(fireId) && r.index === selectedIndex && r.agg === 'median');
            if (fireRows.length > 0) {
                fireRows.sort((a, b) => Number(a.year) - Number(b.year));
                traces.push({
                    x: fireRows.map(r => Number(r.year)),
                    y: fireRows.map(r => r.value),
                    mode: 'lines+markers', name: `Пожар ID: ${fireId}`,
                    line: { color: '#2bb385', width: 3, dash: 'solid' },
                    marker: { size: 6 }
                });
            }
        }
        return traces;
    }
}

async function initDashboard() {
    try {
        const loader = new DataLoader();
        const [geoResponse, _] = await Promise.all([
            fetch('/data/fires_2005_irk_filtered.geojson'),
            loader.loadAllData()
        ]);
        const geojsonData = await geoResponse.json();
        const dataFilter = new DataFilter(loader);
        
        let currentTheme = 'satellite';
        let selectedFireId = null;
        let selectedIndexName = 'NDVI';
        let activeVegType = null;
        let mapInitialized = false; 

        const polygonSelect = document.getElementById('select-polygon');
        const indexSelect = document.getElementById('select-active-index');
        const monthSlider = document.getElementById('slider-month');
        const monthLabel = document.getElementById('month-label');
        const vegTypeSelect = document.getElementById('select-veg-type');
        const areaMinInput = document.getElementById('input-area-min');
        const areaMaxInput = document.getElementById('input-area-max');
        const mainResetBtn = document.getElementById('btn-main-reset');
        const toggleBtn = document.getElementById('btn-toggle-theme');
        const ticksContainer = document.querySelector('.slider-ticks');

        function populatePolygonSelect(features) {
            if (!polygonSelect) return;
            const currentVal = polygonSelect.value;
            polygonSelect.innerHTML = '<option value="All">Все полигоны</option>';
            const ids = [...new Set(features.map(f => f.properties?.fire_id).filter(Boolean))].sort((a,b) => a-b);
            ids.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id; opt.textContent = `Полигон ${id}`;
                polygonSelect.appendChild(opt);
            });
            if (ids.includes(Number(currentVal)) || currentVal === 'All') polygonSelect.value = currentVal;
        }

        function zoomToFire(fireId, featuresList) {
            const target = featuresList.find(f => String(f.properties?.fire_id) === String(fireId));
            if (!target) return;
            const props = target.properties || {};
            const lon = props.lon || target.geometry?.coordinates?.[0];
            const lat = props.lat || target.geometry?.coordinates?.[1];
            if (lon && lat) {
                Plotly.relayout('cnt-map', {
                    'mapbox.center': { lat: Number(lat), lon: Number(lon) },
                    'mapbox.zoom': 9.5,
                    'mapbox.layers': drawDashboardLayersOnly(featuresList)
                });
            }
        }

        function updateFireInfoPanel(fireId, featuresList) {
            const infoPanel = document.getElementById('heat-info');
            if (!infoPanel) return;
            if (!fireId) {
                infoPanel.innerHTML = `<span style="color: #666; font-style: italic;">Кликните на полигон карты или ячейку матрицы для анализа детальной статистики</span>`;
                return;
            }
            const fire = featuresList.find(f => String(f.properties?.fire_id) === String(fireId));
            if (fire && fire.properties) {
                const p = fire.properties;
                infoPanel.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; flex-grow: 1; font-size: 12px;">
                            <div><b>ID Пожара:</b> <span style="color: #ff9307;">${p.fire_id}</span></div>
                            <div><b>Дата обнаружения:</b> <span style="color: #fff;">${p.dt_first || 'Нет данных'}</span></div>
                            <div><b>Период горения:</b> <span style="color: #fff;">${p.duration_days || 1} дн.</span></div>
                            <div><b>Общая площадь:</b> <span style="color: #ff5555;">${p.Area ? p.Area.toFixed(1) : 0} га</span></div>
                            <div><b>Лесная площадь:</b> <span style="color: #2bb385;">${p.Area_les ? p.Area_les.toFixed(1) : 0} га</span></div>
                        </div>
                    </div>`;
            } else {
                infoPanel.innerHTML = `<span style="color: #ff5555;">Пожар с ID ${fireId} не найден в текущих фильтрах</span>`;
            }
        }

        function drawDashboard() {
            const allFeatures = geojsonData.features || [];
            const selectedPolygon = polygonSelect ? polygonSelect.value : 'All';
            
            const sliderVal = monthSlider ? Number(monthSlider.value) : 2;
            if (monthLabel) monthLabel.textContent = MONTH_NAMES[sliderVal];

            if (ticksContainer) {
                ticksContainer.querySelectorAll('span').forEach(tick => {
                    if (Number(tick.getAttribute('data-val')) === sliderVal) {
                        tick.classList.add('active-tick');
                    } else {
                        tick.classList.remove('active-tick');
                    }
                });
            }

            const selectedVegType = vegTypeSelect ? vegTypeSelect.value : 'All';
            const areaMin = areaMinInput && areaMinInput.value !== '' ? Number(areaMinInput.value) : 0;
            const areaMax = areaMaxInput && areaMaxInput.value !== '' ? Number(areaMaxInput.value) : Infinity;

            const filteredFeatures = allFeatures.filter(f => {
                const props = f.properties || {};
                if (selectedPolygon !== 'All' && String(props.fire_id) !== String(selectedPolygon)) return false;
                
                if (props.dt_first && typeof props.dt_first === 'string') {
                    const parts = props.dt_first.split('-');
                    if (sliderVal !== 2 && Number(parts[1]) !== sliderVal) return false;
                } else {
                    if (sliderVal !== 2) return false;
                }
                
                const area = props.Area || 0;
                if (area < areaMin || area > areaMax) return false;
                return true;
            });

            if (document.getElementById('stat-count')) document.getElementById('stat-count').textContent = filteredFeatures.length;
            if (document.getElementById('stat-duration')) {
                const totalDuration = filteredFeatures.reduce((acc, f) => acc + (f.properties?.duration_days || 0), 0);
                document.getElementById('stat-duration').textContent = filteredFeatures.length ? (totalDuration / filteredFeatures.length).toFixed(3) : '0.000';
            }
            
            const lons = [], lats = [], mapTexts = [];
            filteredFeatures.forEach(f => {
                const props = f.properties || {};
                const lon = props.lon || f.geometry?.coordinates?.[0];
                const lat = props.lat || f.geometry?.coordinates?.[1];
                if (lon && lat) {
                    lons.push(Number(lon)); lats.push(Number(lat));
                    mapTexts.push(`<b>ID пожара:</b> ${props.fire_id || '---'}<br><b>Площадь:</b> ${props.Area || 0} га`);
                }
            });
            
            const mapData = [{ type: 'scattermapbox', lon: lons, lat: lats, mode: 'markers', marker: { size: 1, opacity: 0 }, text: mapTexts, hoverinfo: 'text' }];
            let mapStyle = currentTheme === 'satellite' ? 'white-bg' : 'carto-darkmatter';
            let mapLayers = drawDashboardLayersOnly(filteredFeatures);
            
            const mapLayout = {
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { r: 0, t: 0, l: 0, b: 0 }, hovermode: 'closest',
                mapbox: { style: mapStyle, center: { lat: 52.28, lon: 104.28 }, zoom: 6.5, layers: mapLayers },
                showlegend: false
            };
            
            const mapDiv = document.getElementById('cnt-map');
            if (mapDiv) {
                if (mapInitialized) {
                    Plotly.animate('cnt-map', { data: mapData, layout: { 'mapbox.layers': mapLayers } }, { transition: { duration: 0 }, frame: { duration: 0, redraw: true } });
                } else {
                    Plotly.newPlot('cnt-map', mapData, mapLayout, { responsive: true, scrollZoom: true });
                    mapInitialized = true;
                }
                
                mapDiv.removeAllListeners('plotly_click');
                mapDiv.on('plotly_click', (data) => {
                    if (data.points?.length > 0) {
                        const match = data.points[0].text ? data.points[0].text.match(/ID пожара:<\/b>\s*(\d+)/) : null;
                        if (match && match[1]) {
                            selectedFireId = Number(match[1]);
                            if (polygonSelect) polygonSelect.value = selectedFireId;
                            zoomToFire(selectedFireId, filteredFeatures);
                            drawDashboard();
                        }
                    }
                });
            }

            const matrixFeatures = [...filteredFeatures].sort((a, b) => (b.properties?.Area || 0) - (a.properties?.Area || 0));
            const indexTypes = ['Длительность (дни)', 'Площадь (тыс. га)', 'Интенсивность'];
            const zValues = indexTypes.map((type, idx) => matrixFeatures.map(f => {
                const props = f.properties || {};
                if (idx === 0) return props.duration_days || 0;
                if (idx === 1) return (props.Area || 0) / 1000;
                return Math.log1p(props.Area_les || 0);
            }));
            
            const heatmapData = [{
                z: zValues, x: matrixFeatures.map(f => String(f.properties?.fire_id || '---')), y: indexTypes,
                customdata: indexTypes.map(() => matrixFeatures.map(f => f.properties?.fire_id)),
                type: 'heatmap', colorscale: 'YlOrRd', showscale: true,
                hovertemplate: '<b>ID пожара:</b> %{customdata}<br><b>%{y}</b><br>Значение: %{z:.2f}<extra></extra>'
            }];
            
            const heatDiv = document.getElementById('cnt-heat');
            if (heatDiv) {
                Plotly.newPlot(heatDiv, heatmapData, {
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { r: 5, t: 5, l: 130, b: 60 }, font: { color: '#aaa', size: 11 },
                    xaxis: { fixedrange: false, type: 'category', tickangle: -45 }, yaxis: { fixedrange: true }
                }, { responsive: true, displayModeBar: true });
                
                heatDiv.removeAllListeners('plotly_click');
                heatDiv.on('plotly_click', (data) => {
                    if (data.points?.length > 0 && data.points[0].customdata) {
                        selectedFireId = Number(data.points[0].customdata);
                        if (polygonSelect) polygonSelect.value = selectedFireId;
                        zoomToFire(selectedFireId, filteredFeatures);
                        drawDashboard();
                    }
                });
            }

            const priorityDiv = document.getElementById('cnt-index-priority');
            if (priorityDiv) {
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
                const valuesMatrix = [
                    [0.09585, 0.09124, 0.07350, 0.07035, 0.05524, 0.05498, 0.05006, 0.03695, 0.02653, 0.02617, 0.00049, 0.00036, 0.00021, 0.00018, 0.00016, 0.00006, 0.00000, 0.00000, 0.00000],
                    [0.08313, 0.07697, 0.06857, 0.06645, 0.05684, 0.05208, 0.04786, 0.02816, 0.02435, 0.02346, 0.00046, 0.00036, 0.00025, 0.00018, 0.00017, 0.00006, 0.00000, 0.00000, 0.00000],
                    [0.09053, 0.08164, 0.07960, 0.07958, 0.05768, 0.05566, 0.05562, 0.03055, 0.02694, 0.02463, 0.00062, 0.00041, 0.00029, 0.00027, 0.00017, 0.00004, 0.00000, 0.00000, 0.00000],
                    [0.07997, 0.07457, 0.07309, 0.07215, 0.05364, 0.05303, 0.05053, 0.02841, 0.02419, 0.02082, 0.00058, 0.00035, 0.00028, 0.00025, 0.00016, 0.00004, 0.00000, 0.00000, 0.00000],
                    [0.07794, 0.07587, 0.07511, 0.05956, 0.05174, 0.05151, 0.04884, 0.03193, 0.02295, 0.01822, 0.00064, 0.00029, 0.00028, 0.00028, 0.00014, 0.00003, 0.00000, 0.00000, 0.00000],
                    [0.08008, 0.07493, 0.07442, 0.06706, 0.05085, 0.05044, 0.04866, 0.02849, 0.02252, 0.02019, 0.00068, 0.00031, 0.00030, 0.00029, 0.00017, 0.00003, 0.00000, 0.00000, 0.00000],
                    [0.08700, 0.07868, 0.07791, 0.07487, 0.05678, 0.05554, 0.05513, 0.02816, 0.02588, 0.02340, 0.00065, 0.00038, 0.00030, 0.00029, 0.00017, 0.00004, 0.00000, 0.00000, 0.00000]
                ];
                const indexColors = {
                    'NBR': '#e67326', 'NBRPLUS': '#f28e2b', 'IPVI': '#116644', 'NDVI': '#2bb385', 'SAVI': '#bab0ac', 'NDWI': '#a0cbe8', 'MSAVI': '#d3bda5', 'NBR2': '#9c3a3a', 'BAIS2': '#edc948', 'DVI': '#59a14f', 'BAI': '#f1ce63', 'RVI': '#8cd17d', 'GCI': '#76b7b2', 'CIRE': '#499894', 'PSRI': '#7f7f7f', 'SIPI': '#1f77b4', 'EVI': '#bcbd22', 'GARI': '#98df8a', 'ARVI': '#2ca02c'
                };

                let tableHtml = `<div class="tableau-grid-container"><table class="tableau-matrix"><thead><tr><th class="stub-col">Тип растит..</th>`;
                for (let i = 1; i <= 19; i++) tableHtml += `<th>${i}</th>`;
                tableHtml += `</tr></thead><tbody>`;

                for (let y = 0; y < vegTypes.length; y++) {
                    tableHtml += `<tr><td class="row-label">${vegTypes[y]}</td>`;
                    for (let x = 0; x < 19; x++) {
                        const idxName = indicesMatrix[y][x];
                        let cellClass = "matrix-cell" + 
                            ((selectedVegType !== 'All' && vegTypes[y] !== selectedVegType) ? " hidden-by-group" : 
                            (((selectedIndexName && idxName !== selectedIndexName) || (activeVegType && vegTypes[y] !== activeVegType)) ? " faded" : 
                            ((selectedIndexName === idxName && activeVegType === vegTypes[y]) ? " cell-active" : "")));

                        tableHtml += `
                            <td class="${cellClass}" style="background-color: ${indexColors[idxName] || '#666'};" data-index="${idxName}" data-veg="${vegTypes[y]}" title="Индекс: ${idxName}\nЗначение: ${valuesMatrix[y][x]}">
                                <div class="cell-content"><span class="idx-title">${idxName}</span><span class="idx-val">${valuesMatrix[y][x].toFixed(5)}</span></div>
                            </td>`;
                    }
                    tableHtml += `</tr>`;
                }
                priorityDiv.innerHTML = tableHtml + `</tbody></table></div>`;

                priorityDiv.querySelectorAll('.matrix-cell:not(.hidden-by-group)').forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        const targetCell = e.currentTarget;
                        const clickedIndex = targetCell.getAttribute('data-index');
                        const clickedVeg = targetCell.getAttribute('data-veg');
                        if (selectedIndexName === clickedIndex && activeVegType === clickedVeg) { activeVegType = null; } 
                        else { selectedIndexName = clickedIndex; activeVegType = clickedVeg; }
                        if (indexSelect) indexSelect.value = selectedIndexName;
                        if (vegTypeSelect && activeVegType) vegTypeSelect.value = activeVegType;
                        drawDashboard();
                    });
                });
            }

            updateFireInfoPanel(selectedFireId, filteredFeatures);
            updateSecondaryCharts();
        }

        function updateSecondaryCharts() {
            const chartDiv = document.getElementById('cnt-timeline-chart');
            if (!chartDiv) return;
            const timelineTraces = dataFilter.prepareMultiLineNDVI(selectedFireId, selectedIndexName);
            
            let chartTitle = `Динамика спектральных индексов по годам (${selectedIndexName})`;
            if (selectedFireId) chartTitle = `Временные изменения ${selectedIndexName} (Пожар ID: ${selectedFireId})`;
            else if (activeVegType) chartTitle = `Изменения ${selectedIndexName} для типа: ${activeVegType}`;

            Plotly.newPlot(chartDiv, timelineTraces, {
                title: { text: chartTitle, font: { color: '#aaa', size: 14 } },
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { l: 50, r: 20, t: 40, b: 40 }, font: { color: '#aaa' },
                xaxis: { title: 'Год', gridcolor: '#222', dtick: 2 }, yaxis: { title: 'Значение', gridcolor: '#222' },
                showlegend: true, legend: { orientation: 'h', x: 0, y: -0.2 }
            }, { responsive: true });
        }

        function drawDashboardLayersOnly(filteredFeatures) {
            const normalFires = filteredFeatures.filter(f => String(f.properties?.fire_id) !== String(selectedFireId));
            const selectedFires = filteredFeatures.filter(f => String(f.properties?.fire_id) === String(selectedFireId));
            if (currentTheme === 'satellite') {
                return [
                    { sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], below: '' },
                    { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: normalFires }, type: 'fill', color: 'rgba(255, 147, 7, 0.6)', below: '' },
                    { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: selectedFires }, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' },
                    { sourcetype: 'raster', source: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], below: '' }
                ];
            }
            return [
                { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: normalFires }, type: 'fill', color: 'rgba(255, 147, 7, 0.5)', below: '' },
                { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: selectedFires }, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' }
            ];
        }

        if (polygonSelect) {
            polygonSelect.addEventListener('change', (e) => {
                selectedFireId = e.target.value === 'All' ? null : Number(e.target.value);
                if (selectedFireId) zoomToFire(selectedFireId, geojsonData.features || []);
                drawDashboard();
            });
        }

        if (indexSelect) indexSelect.addEventListener('change', (e) => { selectedIndexName = e.target.value; drawDashboard(); });
        if (monthSlider) monthSlider.addEventListener('input', drawDashboard);
        
        if (ticksContainer) {
            ticksContainer.querySelectorAll('span').forEach(tick => {
                tick.addEventListener('click', () => {
                    const val = tick.getAttribute('data-val');
                    if (monthSlider) {
                        monthSlider.value = val;
                        drawDashboard();
                    }
                });
            });
        }

        if (vegTypeSelect) vegTypeSelect.addEventListener('change', (e) => { activeVegType = e.target.value === 'All' ? null : e.target.value; drawDashboard(); });
        if (areaMinInput) areaMinInput.addEventListener('input', drawDashboard);
        if (areaMaxInput) areaMaxInput.addEventListener('input', drawDashboard);

        if (mainResetBtn) {
            mainResetBtn.addEventListener('click', () => {
                if (polygonSelect) polygonSelect.value = 'All';
                if (indexSelect) indexSelect.value = 'NDVI';
                if (monthSlider) monthSlider.value = 2;
                if (vegTypeSelect) vegTypeSelect.value = 'All';
                if (areaMinInput) areaMinInput.value = '';
                if (areaMaxInput) areaMaxInput.value = '';
                
                selectedFireId = null; selectedIndexName = 'NDVI'; activeVegType = null;
                Plotly.relayout('cnt-map', { 'mapbox.zoom': 6.5, 'mapbox.center': { lat: 52.28, lon: 104.28 } });
                drawDashboard();
            });
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                currentTheme = currentTheme === 'satellite' ? 'dark' : 'satellite';
                toggleBtn.textContent = currentTheme === 'satellite' ? 'Тёмная карта' : 'Спутник (Зелень)';
                mapInitialized = false; drawDashboard();
            });
        }

        populatePolygonSelect(geojsonData.features || []);
        drawDashboard();
    } catch (error) {
        console.error("Dashboard error during initialization:", error);
    }
}

window.addEventListener('DOMContentLoaded', initDashboard);