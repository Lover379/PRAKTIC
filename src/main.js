import Plotly from 'plotly.js-dist-min';
import Papa from 'papaparse';

const INDEX_GROUPS = {
    'Выгорание': ['NBR', 'NBRPLUS', 'NBR2', 'BAI', 'BAIS2'],
    'Влажность и старение': ['NDWI', 'PSRI', 'NDVI'],
    'Почва': ['SAVI', 'MSAVI', 'DVI'],
    'Растительность': ['NDVI', 'IPVI', 'RVI', 'EVI', 'ARVI', 'GARI'],
    'Хлорофилл и пигменты': ['GCI', 'CIRE', 'SIPI']
};

class DataLoader {
    constructor() {
        this.data = {
            wide: null,
            long: null,
            viByYear: null,
            ndviAreas: null,
            metadata: null
        };
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
            this.data.ndviAreas = ndviAreas;
            this.data.metadata = metadata;
            this.isLoaded = true;
            return this.data;
        } catch (error) {
            throw error;
        }
    }

    loadCSV(filePath, parser) {
        return new Promise((resolve, reject) => {
            if (!parser) {
                reject(new Error('Papa Parse не найден.'));
                return;
            }
            parser.parse(filePath, {
                download: true,
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (result) => {
                    if (result.errors && result.errors.length > 0) {
                        reject(result.errors);
                    } else {
                        resolve(result.data);
                    }
                },
                error: (error) => reject(error)
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
            ? `${selectedIndex}_median` 
            : 'NDVI_median';

        const bgNDVI = bgYears.map(y => {
            const match = viByYearData.find(r => Number(r.year) === y);
            return match ? match[targetIndexField] : null;
        });

        const traces = [
            {
                x: bgYears,
                y: bgNDVI,
                mode: 'lines',
                name: `Общий тренд ${selectedIndex}`,
                line: { color: '#ff9307', width: 2, dash: 'dot' }
            }
        ];

        if (fireId) {
            const fireRows = longData.filter(r => String(r.fire_id) === String(fireId) && r.index === selectedIndex && r.agg === 'median');
            if (fireRows.length > 0) {
                fireRows.sort((a, b) => Number(a.year) - Number(b.year));
                const fireYears = fireRows.map(r => Number(r.year));
                const fireValues = fireRows.map(r => r.value);
                traces.push({
                    x: fireYears,
                    y: fireValues,
                    mode: 'lines+markers',
                    name: `Пожар ID: ${fireId}`,
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
        
        const monthsMap = {
            3: 'Март', 4: 'Апрель', 5: 'Май', 6: 'Июнь',
            7: 'Июль', 8: 'Август', 9: 'Сентябрь', 10: 'Октябрь'
        };
        
        let currentTheme = 'satellite';
        let selectedFireId = null;
        let selectedIndexName = 'NDVI';
        let selectedGroupFilter = 'All';
        let activeVegType = null;
        let mapInitialized = false; 

        const slider = document.getElementById('month-slider');
        const monthLabel = document.getElementById('month-label');
        const toggleBtn = document.getElementById('btn-toggle-theme');
        
        const groupSelect = document.getElementById('select-index-group');
        const indexSelect = document.getElementById('select-active-index');
        const forestrySelect = document.getElementById('select-forestry');
        const timeScaleSelect = document.getElementById('select-time-scale');
        
        let currentMonth = slider ? slider.value : '3';

        if (loader.data.metadata && forestrySelect) {
            const forestries = [...new Set(loader.data.metadata.map(r => r.forestry).filter(Boolean))].sort();
            forestries.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = f;
                forestrySelect.appendChild(opt);
            });
        }

        function zoomToFire(fireId, featuresList) {
            const target = featuresList.find(f => String(f.properties?.fire_id) === String(fireId));
            if (!target) return;
            const props = target.properties || {};
            const lon = props.lon || target.geometry?.coordinates?.[0];
            const lat = props.lat || target.geometry?.coordinates?.[1];
            if (lon && lat) {
                const updatedLayers = drawDashboardLayersOnly(featuresList);
                Plotly.relayout('cnt-map', {
                    'mapbox.center': { lat: Number(lat), lon: Number(lon) },
                    'mapbox.zoom': 9.5,
                    'mapbox.layers': updatedLayers
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
                        <button id="btn-reset-fire" class="btn-theme" style="margin-left: 15px; border-color: #ff5555; color: #ff5555; padding: 4px 10px;">Сбросить х</button>
                    </div>
                `;

                document.getElementById('btn-reset-fire').addEventListener('click', () => {
                    selectedFireId = null;
                    Plotly.relayout('cnt-map', {
                        'mapbox.zoom': 6.5,
                        'mapbox.center': { lat: 52.28, lon: 104.28 }
                    });
                    drawDashboard();
                });
            } else {
                infoPanel.innerHTML = `<span style="color: #ff5555;">Пожар с ID ${fireId} не найден в текущем периоде</span>`;
            }
        }

        function drawDashboard() {
            const allFeatures = geojsonData.features || [];
            const selectedForestry = forestrySelect ? forestrySelect.value : 'All';

            const filteredFeatures = allFeatures.filter(f => {
                const props = f.properties || {};
                const dtFirst = props.dt_first;
                if (!dtFirst || typeof dtFirst !== 'string') return false;
                const parts = dtFirst.split('-');
                const matchesMonth = parts.length >= 2 && Number(parts[1]) === Number(currentMonth);
                const matchesForestry = selectedForestry === 'All' || String(props.forestry) === String(selectedForestry);
                return matchesMonth && matchesForestry;
            });

            if (document.getElementById('stat-count')) {
                document.getElementById('stat-count').textContent = filteredFeatures.length;
            }
            if (document.getElementById('stat-duration')) {
                const totalDuration = filteredFeatures.reduce((acc, f) => acc + (f.properties?.duration_days || 0), 0);
                document.getElementById('stat-duration').textContent = filteredFeatures.length ? (totalDuration / filteredFeatures.length).toFixed(3) : '0.000';
            }
            
            const lons = [];
            const lats = [];
            const mapTexts = [];
            filteredFeatures.forEach(f => {
                const props = f.properties || {};
                const lon = props.lon || f.geometry?.coordinates?.[0];
                const lat = props.lat || f.geometry?.coordinates?.[1];
                if (lon && lat) {
                    lons.push(Number(lon));
                    lats.push(Number(lat));
                    mapTexts.push(`<b>ID пожара:</b> ${props.fire_id || '---'}<br><b>Площадь:</b> ${props.Area || 0} га`);
                }
            });
            
            const mapData = [{
                type: 'scattermapbox',
                lon: lons,
                lat: lats,
                mode: 'markers',
                marker: { size: 1, opacity: 0 },
                text: mapTexts,
                hoverinfo: 'text'
            }];
            
            let mapStyle = 'white-bg';
            let mapLayers = drawDashboardLayersOnly(filteredFeatures);
            if (currentTheme !== 'satellite') {
                mapStyle = 'carto-darkmatter';
            }
            
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
                        const txt = data.points[0].text;
                        const match = txt ? txt.match(/ID пожара:<\/b>\s*(\d+)/) : null;
                        if (match && match[1]) {
                            selectedFireId = Number(match[1]);
                            zoomToFire(selectedFireId, filteredFeatures);
                            updateSecondaryCharts();
                            updateFireInfoPanel(selectedFireId, filteredFeatures);
                        }
                    }
                });
            }

            const matrixFeatures = [...filteredFeatures].sort((a, b) => (b.properties?.Area || 0) - (a.properties?.Area || 0));
            const fireIdsLabels = matrixFeatures.map(f => String(f.properties?.fire_id || '---'));
            const indexTypes = ['Длительность (дни)', 'Площадь (тыс. га)', 'Интенсивность'];
            const zValues = indexTypes.map((type, idx) => {
                return matrixFeatures.map(f => {
                    const props = f.properties || {};
                    if (idx === 0) return props.duration_days || 0;
                    if (idx === 1) return (props.Area || 0) / 1000;
                    return Math.log1p(props.Area_les || 0);
                });
            });
            
            const customDataMatrix = indexTypes.map(() => matrixFeatures.map(f => f.properties?.fire_id));
            const heatmapData = [{
                z: zValues, 
                x: fireIdsLabels, 
                y: indexTypes,
                customdata: customDataMatrix,
                type: 'heatmap', 
                colorscale: 'YlOrRd', 
                showscale: true,
                hovertemplate: '<b>ID пожара:</b> %{customdata}<br><b>%{y}</b><br>Значение: %{z:.2f}<extra></extra>'
            }];
            
            const heatDiv = document.getElementById('cnt-heat');
            if (heatDiv) {
                Plotly.newPlot(heatDiv, heatmapData, {
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { r: 5, t: 5, l: 130, b: 60 }, font: { color: '#aaa', size: 11 },
                    xaxis: { fixedrange: false, type: 'category', tickangle: -45 }, 
                    yaxis: { fixedrange: true }
                }, { responsive: true, displayModeBar: true });
                
                heatDiv.removeAllListeners('plotly_click');
                heatDiv.on('plotly_click', (data) => {
                    if (data.points?.length > 0) {
                        const clickedFireId = data.points[0].customdata;
                        if (clickedFireId) {
                            selectedFireId = Number(clickedFireId);
                            zoomToFire(selectedFireId, filteredFeatures);
                            updateSecondaryCharts();
                            updateFireInfoPanel(selectedFireId, filteredFeatures);
                        }
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
                    'NBR': '#e67326', 'NBRPLUS': '#f28e2b', 'IPVI': '#116644', 'NDVI': '#2bb385',
                    'SAVI': '#bab0ac', 'NDWI': '#a0cbe8', 'MSAVI': '#d3bda5', 'NBR2': '#9c3a3a',
                    'BAIS2': '#edc948', 'DVI': '#59a14f', 'BAI': '#f1ce63', 'RVI': '#8cd17d',
                    'GCI': '#76b7b2', 'CIRE': '#499894', 'PSRI': '#7f7f7f', 'SIPI': '#1f77b4',
                    'EVI': '#bcbd22', 'GARI': '#98df8a', 'ARVI': '#2ca02c'
                };

                let tableHtml = `<div class="tableau-grid-container">
                    <table class="tableau-matrix">
                        <thead>
                            <tr>
                                <th class="stub-col">Тип растит..</th>`;
                for (let i = 1; i <= 19; i++) {
                    tableHtml += `<th>${i}</th>`;
                }
                tableHtml += `</tr></thead><tbody>`;

                for (let y = 0; y < vegTypes.length; y++) {
                    tableHtml += `<tr><td class="row-label">${vegTypes[y]}</td>`;
                    for (let x = 0; x < 19; x++) {
                        const idxName = indicesMatrix[y][x];
                        const val = valuesMatrix[y][x];
                        const baseColor = indexColors[idxName] || '#666';

                        let cellClass = "matrix-cell";
                        
                        const belongsToGroup = selectedGroupFilter === 'All' || 
                            (INDEX_GROUPS[selectedGroupFilter] && INDEX_GROUPS[selectedGroupFilter].includes(idxName));

                        if (!belongsToGroup) {
                            cellClass += " hidden-by-group";
                        } else {
                            if (selectedIndexName && idxName !== selectedIndexName) {
                                cellClass += " faded";
                            }
                            if (activeVegType && vegTypes[y] !== activeVegType) {
                                cellClass += " faded";
                            }
                            if (selectedIndexName === idxName && activeVegType === vegTypes[y]) {
                                cellClass += " cell-active";
                            }
                        }

                        tableHtml += `
                            <td class="${cellClass}" 
                                style="background-color: ${baseColor};" 
                                data-index="${idxName}" 
                                data-veg="${vegTypes[y]}"
                                title="Группа: ${selectedGroupFilter}\nИндекс: ${idxName}\nЗначение: ${val}">
                                <div class="cell-content">
                                    <span class="idx-title">${idxName}</span>
                                    <span class="idx-val">${val.toFixed(5)}</span>
                                </div>
                            </td>`;
                    }
                    tableHtml += `</tr>`;
                }
                tableHtml += `</tbody></table></div>`;
                priorityDiv.innerHTML = tableHtml;

                priorityDiv.querySelectorAll('.matrix-cell:not(.hidden-by-group)').forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        const targetCell = e.currentTarget;
                        const clickedIndex = targetCell.getAttribute('data-index');
                        const clickedVeg = targetCell.getAttribute('data-veg');
                        
                        if (selectedIndexName === clickedIndex && activeVegType === clickedVeg) {
                            activeVegType = null;
                        } else {
                            selectedIndexName = clickedIndex;
                            activeVegType = clickedVeg;
                        }
                        
                        if (indexSelect) indexSelect.value = selectedIndexName;
                        
                        drawDashboard();
                    });
                });
            }

            updateFireInfoPanel(selectedFireId, filteredFeatures);
            updateSecondaryCharts();
        }

        function updateSecondaryCharts() {
            const trendDiv = document.getElementById('cnt-trend');
            if (trendDiv) {
                const trendTraces = dataFilter.prepareMultiLineNDVI(selectedFireId, selectedIndexName);
                
                let trendTitle = ` ${selectedIndexName}`;
                if (selectedFireId) {
                    trendTitle = `Динамика ${selectedIndexName} (Пожар ID: ${selectedFireId})`;
                } else if (activeVegType) {
                    trendTitle = `${selectedIndexName} для типа: ${activeVegType}`;
                }

                const trendLayout = {
                    title: { text: trendTitle, font: { color: '#aaa', size: 14 } },
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { l: 50, r: 20, t: 40, b: 40 }, font: { color: '#aaa' },
                    xaxis: { title: 'Год', gridcolor: '#222', dtick: 2 }, yaxis: { title: 'Значение', gridcolor: '#222' },
                    showlegend: true, legend: { orientation: 'h', x: 0, y: -0.2 }
                };
                Plotly.newPlot(trendDiv, trendTraces, trendLayout, { responsive: true });
            }
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
            } else {
                return [
                    { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: normalFires }, type: 'fill', color: 'rgba(255, 147, 7, 0.5)', below: '' },
                    { sourcetype: 'geojson', source: { type: 'FeatureCollection', features: selectedFires }, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' }
                ];
            }
        }

        if (groupSelect) {
            groupSelect.addEventListener('change', (e) => {
                selectedGroupFilter = e.target.value;
                drawDashboard();
            });
        }

        if (indexSelect) {
            indexSelect.addEventListener('change', (e) => {
                selectedIndexName = e.target.value;
                drawDashboard();
            });
        }

        if (forestrySelect) forestrySelect.addEventListener('change', drawDashboard);
        if (timeScaleSelect) timeScaleSelect.addEventListener('change', drawDashboard);

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                currentTheme = currentTheme === 'satellite' ? 'dark' : 'satellite';
                toggleBtn.textContent = currentTheme === 'satellite' ? 'Тёмная карта' : 'Спутник (Зелень)';
                mapInitialized = false; 
                drawDashboard();
            });
        }

        if (slider && monthLabel) {
            slider.addEventListener('input', (e) => {
                currentMonth = e.target.value;
                selectedFireId = null;
                monthLabel.textContent = monthsMap[currentMonth];
                drawDashboard();
            });
            monthLabel.textContent = monthsMap[currentMonth];
        }

        drawDashboard();
    } catch (error) {
        console.error("Dashboard error during initialization:", error);
    }
}

window.addEventListener('DOMContentLoaded', initDashboard);