import Plotly from 'plotly.js-dist-min';

async function initMap() {
    try {
        const response = await fetch('/data/fires_2005_irk_filtered.geojson');
        const geojsonData = await response.json();

        const monthsMap = {
            3: 'Март', 4: 'Апрель', 5: 'Май', 6: 'Июнь',
            7: 'Июль', 8: 'Август', 9: 'Сентябрь', 10: 'Октябрь'
        };

        let currentTheme = 'satellite';
        
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
            const geoJsonSource = { type: 'FeatureCollection', features: filteredFeatures };

            if (currentTheme === 'satellite') {
                mapStyle = 'white-bg';
                mapLayers = [
                    { sourcetype: 'raster', source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], below: '' },
                    { sourcetype: 'geojson', source: geoJsonSource, type: 'fill', color: 'rgba(255, 147, 7, 0.7)', below: '' },
                    { sourcetype: 'raster', source: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'], below: '' }
                ];
            } else {
                mapStyle = 'carto-darkmatter';
                mapLayers = [
                    { sourcetype: 'geojson', source: geoJsonSource, type: 'fill', color: 'rgba(255, 147, 7, 0.7)', below: '' }
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

            Plotly.newPlot('cnt-map', mapData, mapLayout, { responsive: true, scrollZoom: true });

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
                xaxis: {
                    showticklabels: true,
                    fixedrange: true,
                    gridcolor: '#222'
                },
                yaxis: {
                    fixedrange: true
                }
            };

            if (matrixFeatures.length > 0) {
                Plotly.newPlot('cnt-heat', heatmapData, heatmapLayout, { responsive: true, displayModeBar: false });
            } else {
                document.getElementById('cnt-heat').innerHTML = '<span style="color:#555; font-size:14px;">Нет данных за этот месяц</span>';
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
                drawDashboard();
            });
        }

        if (slider && monthLabel) {
            slider.addEventListener('input', (e) => {
                currentMonth = e.target.value;
                monthLabel.textContent = monthsMap[currentMonth];
                drawDashboard();
            });
            monthLabel.textContent = monthsMap[currentMonth];
        }

    } catch (error) {
        console.error('Ошибка в дашборде:', error);
    }
}

window.addEventListener('DOMContentLoaded', initMap);