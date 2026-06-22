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
                color: 'red',
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
                style: 'carto-darkmatter',
                center: { lat: 55.2, lon: 104.3 },
                zoom: 4.8,
                layers: [
                    {
                        sourcetype: 'geojson',
                        source: geojsonData,
                        type: 'fill',
                        color: 'rgba(255, 147, 7, 0.6)',
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

    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
}

window.addEventListener('DOMContentLoaded', initMap);