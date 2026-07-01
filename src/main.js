import Plotly from 'plotly.js-dist-min';
import Papa from 'papaparse';

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

    prepareMultiLineNDVI(fireId) {
        const viByYearData = this.dataLoader.data.viByYear || [];
        const longData = this.dataLoader.data.long || [];
        
        const bgYears = viByYearData.map(r => Number(r.year)).sort((a, b) => a - b);
        const bgNDVI = bgYears.map(y => {
            const match = viByYearData.find(r => Number(r.year) === y);
            return match ? match['NDVI_median'] : null;
        });

        const traces = [
            {
                x: bgYears,
                y: bgNDVI,
                mode: 'lines',
                name: 'Общий тренд NDVI',
                line: { color: '#ff9307', width: 2, dash: 'dot' }
            }
        ];

        if (fireId) {
            const fireRows = longData.filter(r => String(r.fire_id) === String(fireId) && r.index === 'NDVI' && r.agg === 'median');
            
            if (fireRows.length > 0) {
                fireRows.sort((a, b) => Number(a.year) - Number(b.year));
                
                const fireYears = fireRows.map(r => Number(r.year));
                const fireValues = fireRows.map(r => r.value);

                traces.push({
                    x: fireYears,
                    y: fireValues,
                    mode: 'lines+markers',
                    name: `Пожар ID: ${fireId}`,
                    line: { color: '#81c784', width: 3, dash: 'solid' },
                    marker: { size: 6 }
                });
            }
        }

        return traces;
    }

    prepareClassDistribution() {
        const ndviAreasData = this.dataLoader.data.ndviAreas || [];
        const years = ndviAreasData.map(r => Number(r.year)).sort((a, b) => a - b);
        
        const totalClasses = 13; 
        const classTraces = [];

        const colors = [
            '#634121', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', 
            '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30',
            '#1b7837', '#4d9221', '#7fbc41'
        ];

        for (let c = 0; c < totalClasses; c++) {
            const key = `ndvi_class_${c}_ha`;
            const yValues = years.map(y => {
                const match = ndviAreasData.find(r => Number(r.year) === y);
                return match ? match[key] || 0 : 0;
            });

            classTraces.push({
                x: years,
                y: yValues,
                name: `Класс ${c}`,
                type: 'bar',
                marker: { color: colors[c] || '#ccc' }
            });
        }

        return classTraces;
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
        let mapInitialized = false; 
        
        const slider = document.getElementById('month-slider');
        const monthLabel = document.getElementById('month-label');
        const toggleBtn = document.getElementById('btn-toggle-theme');

        let currentMonth = slider ? slider.value : '3';

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

        function drawDashboard() {
            const allFeatures = geojsonData.features || [];
            
            const filteredFeatures = allFeatures.filter(f => {
                const props = f.properties || {};
                const dtFirst = props.dt_first;
                if (!dtFirst || typeof dtFirst !== 'string') return false;
                const parts = dtFirst.split('-');
                return parts.length >= 2 && Number(parts[1]) === Number(currentMonth);
            });

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

            const heatDiv = document.getElementById('cnt-priority') || document.getElementById('cnt-heat');
            if (heatDiv) {
                Plotly.newPlot(heatDiv, heatmapData, {
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { r: 5, t: 5, l: 130, b: 50 }, font: { color: '#aaa', size: 11 },
                    xaxis: { fixedrange: true, type: 'category', tickangle: -45 }, yaxis: { fixedrange: true }
                }, { responsive: true, displayModeBar: false });

                heatDiv.removeAllListeners('plotly_click');
                heatDiv.on('plotly_click', (data) => {
                    if (data.points?.length > 0) {
                        const clickedFireId = data.points[0].customdata;
                        if (clickedFireId) {
                            selectedFireId = Number(clickedFireId);
                            zoomToFire(selectedFireId, filteredFeatures);
                            updateSecondaryCharts();
                        }
                    }
                });
            }

            updateSecondaryCharts();
        }

        function updateSecondaryCharts() {
            const trendDiv = document.getElementById('cnt-trend');
            if (trendDiv) {
                const trendTraces = dataFilter.prepareMultiLineNDVI(selectedFireId);
                const trendLayout = {
                    title: { text: selectedFireId ? `Динамика NDVI (Пожар ID: ${selectedFireId})` : `Многолетний тренд NDVI`, font: { color: '#aaa', size: 14 } },
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { l: 50, r: 20, t: 40, b: 40 }, font: { color: '#aaa' },
                    xaxis: { title: 'Год', gridcolor: '#222', dtick: 2 }, yaxis: { title: 'Value', gridcolor: '#222' },
                    showlegend: true, legend: { orientation: 'h', x: 0, y: -0.2 }
                };
                Plotly.newPlot(trendDiv, trendTraces, trendLayout, { responsive: true });
            }

            const classDiv = document.getElementById('cnt-classes') || document.getElementById('cnt-veg-index');
            if (classDiv) {
                const classTraces = dataFilter.prepareClassDistribution();
                const classLayout = {
                    title: { text: `Распределение классов вегетации (га)`, font: { color: '#aaa', size: 14 } },
                    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                    margin: { l: 60, r: 20, t: 40, b: 40 }, font: { color: '#aaa' },
                    xaxis: { title: 'Год', gridcolor: '#222', dtick: 2 }, yaxis: { title: 'Площадь (га)', gridcolor: '#222' },
                    barmode: 'stack', showlegend: false
                };
                Plotly.newPlot(classDiv, classTraces, classLayout, { responsive: true });
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
        console.error(error);
    }
}

window.addEventListener('DOMContentLoaded', initDashboard);