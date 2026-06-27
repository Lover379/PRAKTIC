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

        function draw() {
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
            const texts = [];

            filteredFeatures.forEach(f => {
                const props = f.properties || {};
                const lon = props.lon || f.geometry?.coordinates?.[0];
                const lat = props.lat || f.geometry?.coordinates?.[1];
                
                if (lon && lat) {
                    lons.push(Number(lon));
                    lats.push(Number(lat));

                    const formatDate = (str) => {
                        if (!str || typeof str !== 'string') return '---';
                        return str.replace('T', ' в ');
                    };

                    const firstDate = formatDate(props.dt_first);
                    const lastDate = formatDate(props.dt_last);
                    const liqDate = formatDate(props.dt_liq);

                    texts.push(
                        `<b>ID пожара:</b> ${props.fire_id || '---'}<br>` +
                        `<b>Площадь:</b> ${props.Area || 0} га<br>` +
                        `<b>Обнаружен:</b> ${firstDate}<br>` +
                        `<b>Посл. фиксация:</b> ${lastDate}<br>` +
                        `<b>Ликвидирован:</b> ${liqDate}`
                    );
                }
            });

            const data = [{
                type: 'scattermapbox',
                lon: lons,
                lat: lats,
                mode: 'markers',
                marker: { size: 1, opacity: 0 },
                text: texts,
                hoverinfo: 'text'
            }];

            let mapStyle = 'white-bg';
            let layers = [];

            const geoJsonSource = {
                type: 'FeatureCollection',
                features: filteredFeatures
            };

            if (currentTheme === 'satellite') {
                mapStyle = 'white-bg';
                layers = [
                    {
                        sourcetype: 'raster',
                        source: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                        below: ''
                    },
                    {
                        sourcetype: 'geojson',
                        source: geoJsonSource,
                        type: 'fill',
                        color: 'rgba(255, 147, 7, 0.7)',
                        below: ''
                    },
                    {
                        sourcetype: 'raster',
                        source: ['https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'],
                        below: ''
                    }
                ];
            } else {
                mapStyle = 'carto-darkmatter';
                layers = [
                    {
                        sourcetype: 'geojson',
                        source: geoJsonSource,
                        type: 'fill',
                        color: 'rgba(255, 147, 7, 0.7)',
                        below: ''
                    }
                ];
            }

            const layout = {
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                margin: { r: 0, t: 0, l: 0, b: 0 },
                hovermode: 'closest',
                mapbox: {
                    style: mapStyle,
                    center: { lat: 53.2, lon: 105.0 },
                    zoom: 5.0,
                    layers: layers
                },
                showlegend: false
            };

            Plotly.newPlot('cnt-map', data, layout, { responsive: true, scrollZoom: true });
        }

        draw();

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (currentTheme === 'satellite') {
                    currentTheme = 'dark';
                    toggleBtn.textContent = 'Спутник (Зелень)';
                } else {
                    currentTheme = 'satellite';
                    toggleBtn.textContent = 'Тёмная карта';
                }
                draw();
            });
        }

        if (slider && monthLabel) {
            slider.addEventListener('input', (e) => {
                currentMonth = e.target.value;
                monthLabel.textContent = monthsMap[currentMonth];
                draw();
            });
            monthLabel.textContent = monthsMap[currentMonth];
        }

    } catch (error) {
        console.error('Ошибка:', error);
    }
}

window.addEventListener('DOMContentLoaded', initMap);