import Plotly from 'plotly.js-dist-min';

async function initMap() {
    try {
        const response = await fetch('/data/fires_2005_irk_filtered.geojson');
        const geojsonData = await response.json();

        const lons = [];
        const lats = [];
        const texts = [];

        if (geojsonData && geojsonData.features) {
            geojsonData.features.forEach(feature => {
                const props = feature.properties || {};
                const lon = props.lon;
                const lat = props.lat;

                if (lon && lat) {
                    lons.push(Number(lon));
                    lats.push(Number(lat));

                    const fireId = props.fire_id || 'Неизвестно';
                    const year = props.year || '2005';
                    
                    texts.push(`ID пожара: ${fireId}<br>Год: ${year}`);
                }
            });
        }

        const data = [{
            type: 'scattermapbox',
            lon: lons,
            lat: lats,
            mode: 'markers',
            marker: {
                size: 15,
                color: 'rgba(255, 147, 7, 0.6)',
                opacity: 0
            },
            text: texts,
            hoverinfo: 'text'
        }];

        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { r: 0, t: 0, l: 0, b: 0 },
            hovermode: 'closest',
            mapbox: {
                style: 'white-bg',
                center: { lat: 55.2, lon: 104.3 },
                zoom: 4.8,
                layers: [
                    {
                        sourcetype: 'raster',
                        source: [
                            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                        ],
                        below: ''
                    },
                    {
                        sourcetype: 'geojson',
                        source: geojsonData,
                        type: 'fill',
                        color: 'rgba(255, 147, 7, 0.6)',
                        below: ''
                    },
                    {
                        sourcetype: 'raster',
                        source: [
                            'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'
                        ],
                        below: ''
                    }
                ]
            },
            showlegend: false
        };

        const config = {
            responsive: true,
            scrollZoom: true
        };

        Plotly.newPlot('cnt-map', data, layout, config);

        let currentTheme = 'satellite';
        const toggleBtn = document.getElementById('btn-toggle-theme');

        if (toggleBtn) {
            toggleBtn.textContent = 'Тёмная карта';

            toggleBtn.addEventListener('click', () => {
                if (currentTheme === 'satellite') {
                    Plotly.relayout('cnt-map', { 
                        'mapbox.style': 'carto-darkmatter',
                        'mapbox.layers': [
                            {
                                sourcetype: 'geojson',
                                source: geojsonData,
                                type: 'fill',
                                color: 'rgba(255, 147, 7, 0.6)',
                                below: ''
                            }
                        ]
                    });
                    toggleBtn.textContent = 'Спутник (Зелень)';
                    currentTheme = 'dark';
                } else {
                    Plotly.relayout('cnt-map', { 
                        'mapbox.style': 'white-bg',
                        'mapbox.layers': [
                            {
                                sourcetype: 'raster',
                                source: [
                                    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                                ],
                                below: ''
                            },
                            {
                                sourcetype: 'geojson',
                                source: geojsonData,
                                type: 'fill',
                                color: 'rgba(255, 147, 7, 0.6)',
                                below: ''
                            },
                            {
                                sourcetype: 'raster',
                                source: [
                                    'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png'
                                ],
                                below: ''
                            }
                        ]
                    });
                    toggleBtn.textContent = 'Тёмная карта';
                    currentTheme = 'satellite';
                }
            });
        }

    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
}

window.addEventListener('DOMContentLoaded', initMap);