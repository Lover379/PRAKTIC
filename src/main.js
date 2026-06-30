import Plotly from 'plotly.js-dist-min';
import Papa from 'papaparse';

class DataLoader {
    constructor() {
        this.data = {
            wide: null,
            stats: null,
            viByYear: null,
            ndviAreas: null,
            metadata: null,
            vegetation: null
        };
        this.isLoaded = false;
    }

    async loadAllData() {
        try {
            const parser = typeof Papa !== 'undefined' ? Papa : window.Papa;

            const [wide, stats, viByYear, ndviAreas, metadata, vegetation] = await Promise.all([
                this.loadCSV('/data/vi_wide_format.csv', parser),
                this.loadCSV('/data/vi_stats_test.csv', parser),
                this.loadCSV('/data/dashboard_vi_by_year.csv', parser),
                this.loadCSV('/data/dashboard_ndvi_areas.csv', parser),
                this.loadCSV('/data/dashboard_fires_metadata.csv', parser),
                this.loadCSV('/data/areas_vegetation_in_fires_2005.csv', parser)
            ]);

            this.data.wide = wide;
            this.data.stats = stats;
            this.data.viByYear = viByYear;
            this.data.ndviAreas = ndviAreas;
            this.data.metadata = metadata;
            this.data.vegetation = vegetation;
            
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

    prepareDynamicTrend(fireId, indexName = 'NDVI') {
        const key = `${indexName}_median`;

        if (fireId) {
            const statsData = this.dataLoader.data.stats || [];
            const fireStats = statsData.filter(r => r.fire_id === fireId);
            const sorted = [...fireStats].sort((a, b) => a.year - b.year);
            return {
                dates: sorted.map(r => r.year.toString()),
                values: sorted.map(r => r[key] !== undefined ? r[key] : null),
                title: `Многолетний тренд ${indexName} для пожара ID: ${fireId}`
            };
        } else {
            const totalData = this.dataLoader.data.viByYear || [];
            const sorted = [...totalData].sort((a, b) => a.year - b.year);
            return {
                dates: sorted.map(r => r.year.toString()),
                values: sorted.map(r => r[key] !== undefined ? r[key] : null),
                title: `Общий многолетний тренд ${indexName} по региону (ср. значения)`
            };
        }
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

        function drawDashboard() {
            const allFeatures = geojsonData.features || [];
            
            const filteredFeatures = allFeatures.filter(f => {
                const props = f.properties || {};
                const dtFirst = props.dt_first;
                
                if (!dtFirst || typeof dtFirst !== 'string') return false;

                const parts = dtFirst.split('-');
                if (parts.length >= 2) {
                    const extractedMonth = Number(parts[1]);
                    return extractedMonth === Number(currentMonth);
                }
                
                return false;
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

                    const formatDate = (str) => {
                        if (!str || typeof str !== 'string') return '---';
                        let formatted = str.replace('T', ' в ');
                        if (formatted.length > 16) formatted = formatted.slice(0, 16);
                        return formatted;
                    };

                    mapTexts.push(
                        `<b>ID пожара:</b> ${props.fire_id || '---'}<br>` +
                        `<b>Площадь:</b> ${props.Area || 0} га<br>` +
                        `<b>Обнаружен:</b> ${formatDate(props.dt_first)}<br>` +
                        `<b>Посл. фиксация:</b> ${formatDate(props.dt_last)}<br>` +
                        `<b>Ликвидирован:</b> ${formatDate(props.dt_liq)}`
                    );
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
            let mapLayers = [];

            const normalFires = filteredFeatures.filter(f => f.properties?.fire_id !== selectedFireId);
            const selectedFires = filteredFeatures.filter(f => f.properties?.fire_id === selectedFireId);

            const geoJsonNormal = { type: 'FeatureCollection', features: normalFires };
            const geoJsonSelected = { type: 'FeatureCollection', features: selectedFires };

            if (currentTheme === 'satellite') {
                mapStyle = 'white-bg';
                mapLayers = [
                    { sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], below: '' },
                    { sourcetype: 'geojson', source: geoJsonNormal, type: 'fill', color: 'rgba(255, 147, 7, 0.6)', below: '' },
                    { sourcetype: 'geojson', source: geoJsonSelected, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' },
                    { sourcetype: 'raster', source: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], below: '' }
                ];
            } else {
                mapStyle = 'carto-darkmatter';
                mapLayers = [
                    { sourcetype: 'geojson', source: geoJsonNormal, type: 'fill', color: 'rgba(255, 147, 7, 0.5)', below: '' },
                    { sourcetype: 'geojson', source: geoJsonSelected, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' }
                ];
            }

            const mapLayout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { r: 0, t: 0, l: 0, b: 0 },
                hovermode: 'closest',
                mapbox: { style: mapStyle, center: { lat: 52.28, lon: 104.28 }, zoom: 6.5, layers: mapLayers },
                showlegend: false
            };

            if (mapInitialized) {
                Plotly.animate('cnt-map', {
                    data: mapData,
                    layout: { 'mapbox.layers': mapLayers }
                }, {
                    transition: { duration: 0 },
                    frame: { duration: 0, redraw: true }
                });
            } else {
                Plotly.newPlot('cnt-map', mapData, mapLayout, { responsive: true, scrollZoom: true });
                mapInitialized = true;
            }

            const mapDiv = document.getElementById('cnt-map');
            mapDiv.removeAllListeners('plotly_click');
            mapDiv.on('plotly_click', (data) => {
                if (data.points?.length > 0) {
                    const txt = data.points[0].text;
                    const match = txt ? txt.match(/ID пожара:<\/b>\s*(\d+)/) : null;
                    if (match && match[1]) {
                        selectedFireId = Number(match[1]);
                        const props = filteredFeatures.find(f => f.properties?.fire_id === selectedFireId)?.properties || {};
                        
                        const infoDiv = document.getElementById('heat-info');
                        if (infoDiv) {
                            infoDiv.innerHTML = `<span style="color:#ff9307; font-weight:bold;">Выбран пожар ID: ${selectedFireId}</span> &nbsp;|&nbsp; <b>Площадь:</b> ${props.Area || 0} га`;
                        }
                        
                        updateSecondaryCharts();
                        drawDashboard();
                    }
                }
            });

            const matrixFeatures = [...filteredFeatures]
                .sort((a, b) => (b.properties?.Area || 0) - (a.properties?.Area || 0))
                .slice(0, 15);
            
            const shortLabels = matrixFeatures.map((f, i) => `№${i + 1}`);
            const indexTypes = ['Длительность (дни)', 'Площадь (тыс. га)', 'Интенсивность'];
            
            const zValues = indexTypes.map((type, idx) => {
                return matrixFeatures.map(f => {
                    const props = f.properties || {};
                    if (idx === 0) return props.duration_days || 0;
                    if (idx === 1) return (props.Area || 0) / 1000;
                    return Math.log1p(props.Area_les || 0);
                });
            });

            const textMatrix = indexTypes.map((type, idx) => {
                return matrixFeatures.map(f => `ID: ${f.properties?.fire_id || '---'}`);
            });

            const heatmapData = [{
                z: zValues,
                x: shortLabels,
                y: indexTypes,
                text: textMatrix,
                type: 'heatmap',
                colorscale: 'YlOrRd',
                showscale: true,
                hoverongaps: false,
                hovertemplate: 'Пожар: %{text}<br>Показатель: %{y}<br>Значение: %{z:.2f}<extra></extra>'
            }];

            const heatmapLayout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { r: 5, t: 5, l: 130, b: 35 },
                font: { color: '#aaa', size: 11 },
                xaxis: { showticklabels: true, fixedrange: true, gridcolor: '#222' },
                yaxis: { fixedrange: true }
            };

            const infoDiv = document.getElementById('heat-info');

            if (matrixFeatures.length > 0) {
                const heatDiv = document.getElementById('cnt-heat');
                Plotly.newPlot(heatDiv, heatmapData, heatmapLayout, { responsive: true, displayModeBar: false });

                heatDiv.removeAllListeners('plotly_click');
                heatDiv.on('plotly_click', (data) => {
                    if (data.points && data.points.length > 0) {
                        const pointIndex = data.points[0].pointNumber[1];
                        const clickedFire = matrixFeatures[pointIndex];
                        
                        if (clickedFire) {
                            const props = clickedFire.properties || {};
                            selectedFireId = props.fire_id;
                            
                            const lat = props.lat || clickedFire.geometry?.coordinates?.[0]?.[0]?.[0]?.[1];
                            const lon = props.lon || clickedFire.geometry?.coordinates?.[0]?.[0]?.[0]?.[0];
                            
                            if (infoDiv) {
                                infoDiv.innerHTML = `<span style="color:#ff9307; font-weight:bold;">Выбран пожар №${pointIndex + 1}</span> (ID: ${props.fire_id}) &nbsp;|&nbsp; <b>Площадь:</b> ${props.Area} га &nbsp;|&nbsp; <b>Длительность:</b> ${props.duration_days} дней`;
                            }

                            const updatedLayers = drawDashboardLayersOnly(filteredFeatures);
                            
                            const mapUpdate = {
                                'mapbox.center': { lat: Number(lat), lon: Number(lon) },
                                'mapbox.zoom': 9.5,
                                'mapbox.layers': updatedLayers
                            };
                            
                            Plotly.relayout('cnt-map', mapUpdate);
                            updateSecondaryCharts();
                            drawDashboard();
                        }
                    }
                });

            } else {
                document.getElementById('cnt-heat').innerHTML = '<span style="color:#555; font-size:14px;">Нет данных за этот месяц</span>';
                if (infoDiv) infoDiv.innerHTML = '';
            }

            updateSecondaryCharts();
        }

        function updateSecondaryCharts() {
            const trendData = dataFilter.prepareDynamicTrend(selectedFireId, 'NDVI');
            Plotly.newPlot('cnt-trend', [{
                x: trendData.dates, y: trendData.values, type: 'scatter', mode: 'lines+markers',
                line: { color: selectedFireId ? '#ff4b4b' : '#ff9307', width: 3 }, marker: { size: 6, color: '#ff0000' }
            }], {
                title: { text: trendData.title, font: { color: '#aaa', size: 12 } },
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#aaa', size: 11 },
                margin: { l: 50, r: 15, t: 35, b: 40 }, xaxis: { gridcolor: '#222' }, yaxis: { gridcolor: '#222' }
            }, { responsive: true });
        }

        function drawDashboardLayersOnly(filteredFeatures) {
            const normalFires = filteredFeatures.filter(f => f.properties?.fire_id !== selectedFireId);
            const selectedFires = filteredFeatures.filter(f => f.properties?.fire_id === selectedFireId);
            const geoJsonNormal = { type: 'FeatureCollection', features: normalFires };
            const geoJsonSelected = { type: 'FeatureCollection', features: selectedFires };

            if (currentTheme === 'satellite') {
                return [
                    { sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], below: '' },
                    { sourcetype: 'geojson', source: geoJsonNormal, type: 'fill', color: 'rgba(255, 147, 7, 0.6)', below: '' },
                    { sourcetype: 'geojson', source: geoJsonSelected, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' },
                    { sourcetype: 'raster', source: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], below: '' }
                ];
            } else {
                return [
                    { sourcetype: 'geojson', source: geoJsonNormal, type: 'fill', color: 'rgba(255, 147, 7, 0.5)', below: '' },
                    { sourcetype: 'geojson', source: geoJsonSelected, type: 'fill', color: 'rgba(255, 0, 0, 0.9)', below: '' }
                ];
            }
        }

        drawDashboard();

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (currentTheme === 'satellite') {
                    currentTheme = 'dark';
                    toggleBtn.textContent = 'Спутник (Зелень)';
                } else {
                    currentTheme = 'satellite';
                    toggleBtn.textContent = 'Тёмная карта';
                }
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

    } catch (error) {
        console.error(error);
    }
}

window.addEventListener('DOMContentLoaded', initDashboard);