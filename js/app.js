
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
            console.log(' Загрузка данных...');
            
            const [wide, stats, viByYear, ndviAreas, metadata, vegetation] = await Promise.all([
                this.loadCSV('data/vi_wide_format.csv'),
                this.loadCSV('data/vi_stats_test.csv'),
                this.loadCSV('data/dashboard_vi_by_year.csv'),
                this.loadCSV('data/dashboard_ndvi_areas.csv'),
                this.loadCSV('data/dashboard_fires_metadata.csv'),
                this.loadCSV('data/areas_vegetation_in_fires_2005.csv')
            ]);

            this.data.wide = wide;
            this.data.stats = stats;
            this.data.viByYear = viByYear;
            this.data.ndviAreas = ndviAreas;
            this.data.metadata = metadata;
            this.data.vegetation = vegetation;
            
            this.isLoaded = true;
            console.log(' Все данные загружены!');
            console.log(` wide: ${wide ? wide.length : 0} записей`);
            console.log(` stats: ${stats ? stats.length : 0} записей`);
            
            return this.data;
        } catch (error) {
            console.error('❌ Ошибка загрузки:', error);
            throw error;
        }
    }

    loadCSV(filePath) {
        return new Promise((resolve, reject) => {
            if (typeof Papa === 'undefined') {
                reject(new Error('Papa Parse не загружен'));
                return;
            }
            
            Papa.parse(filePath, {
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

    getPolygons() {
        if (!this.data.wide) return [];
        return this.data.wide.map(row => ({
            id: row.fire_id,
            name: row.frname || `Полигон ${row.fire_id}`,
            area: row.Area,
            vegType: row.veg_name,
            year: row.year
        }));
    }

    getAvailableIndices() {
        return ['NDVI', 'NBR', 'EVI', 'BAI', 'NDWI', 'SAVI', 'NBR2'];
    }

    getYearRange() {
        if (!this.data.stats) return { min: 2000, max: 2025 };
        const years = this.data.stats.map(row => row.year);
        return {
            min: Math.min(...years),
            max: Math.max(...years)
        };
    }

    getFireDate(fireId) {
        if (!this.data.metadata) return null;
        const fire = this.data.metadata.find(row => row.fire_id === fireId);
        return fire ? new Date(fire.dt_first) : null;
    }
}



class DataFilter {
    constructor(dataLoader) {
        this.dataLoader = dataLoader;
        this.currentFilters = {};
    }

    applyFilters(filters = {}) {
        this.currentFilters = { ...this.currentFilters, ...filters };
        
        let dataSource;
        if (this.currentFilters.useStats) {
            dataSource = this.dataLoader.data.stats;
        } else {
            dataSource = this.dataLoader.data.wide;
        }

        if (!dataSource) return [];

        return dataSource.filter(row => {
            let match = true;

            if (this.currentFilters.fireId) {
                match = match && row.fire_id === this.currentFilters.fireId;
            }

            if (this.currentFilters.year && row.year !== undefined) {
                match = match && row.year === parseInt(this.currentFilters.year);
            }

            if (this.currentFilters.indexName) {
                const key = `${this.currentFilters.indexName}_median`;
                match = match && row[key] !== undefined && row[key] !== null;
            }

            if (this.currentFilters.yearRange) {
                const year = row.year || parseInt(row.dt_first?.split('-')[0]);
                match = match && year >= this.currentFilters.yearRange[0] &&
                               year <= this.currentFilters.yearRange[1];
            }

            if (this.currentFilters.vegType) {
                const vegData = this.dataLoader.data.vegetation;
                if (vegData) {
                    const vegRow = vegData.find(v => v.fire_idx == row.fire_id);
                    if (vegRow) {
                        const types = ['Вечнозелёные хвойные леса', 'Листопадные хвойные леса', 
                                     'Листопадные широколиственные леса', 'Смешанные леса', 
                                     'Закрытые кустарники', 'Открытые кустарники', 'Лесистые саванны', 
                                     'Саванны', 'Луга и пастбища'];
                        const hasType = types.some(t => vegRow[t] > 0 && t === this.currentFilters.vegType);
                        match = match && hasType;
                    }
                }
            }

            if (this.currentFilters.areaMin) {
                match = match && row.Area >= this.currentFilters.areaMin;
            }
            if (this.currentFilters.areaMax) {
                match = match && row.Area <= this.currentFilters.areaMax;
            }

            if (this.currentFilters.period && row.dt_first) {
                const fireDate = new Date(row.dt_first);
                const year = row.year || parseInt(row.dt_first.split('-')[0]);
                if (this.currentFilters.period === 'before') {
                    match = match && year < fireDate.getFullYear();
                } else if (this.currentFilters.period === 'after') {
                    match = match && year >= fireDate.getFullYear();
                }
            }

            return match;
        });
    }

    prepareTimeSeriesByYear(filteredData, indexName = 'NDVI') {
        const data = filteredData.length > 0 ? filteredData : this.dataLoader.data.stats;
        if (!data) return { dates: [], values: [], minValues: [], maxValues: [] };

        const yearMap = new Map();
        data.forEach(row => {
            const year = row.year;
            if (!yearMap.has(year)) {
                yearMap.set(year, { values: [], minValues: [], maxValues: [] });
            }
            const medianKey = `${indexName}_median`;
            const minKey = `${indexName}_min`;
            const maxKey = `${indexName}_max`;
            
            if (row[medianKey] !== undefined && row[medianKey] !== null) {
                yearMap.get(year).values.push(row[medianKey]);
                yearMap.get(year).minValues.push(row[minKey] !== undefined ? row[minKey] : row[medianKey]);
                yearMap.get(year).maxValues.push(row[maxKey] !== undefined ? row[maxKey] : row[medianKey]);
            }
        });

        const result = { dates: [], values: [], minValues: [], maxValues: [] };
        const sortedYears = Array.from(yearMap.keys()).sort();
        
        sortedYears.forEach(year => {
            const data = yearMap.get(year);
            result.dates.push(year.toString());
            result.values.push(data.values.reduce((a, b) => a + b, 0) / data.values.length);
            result.minValues.push(Math.min(...data.minValues));
            result.maxValues.push(Math.max(...data.maxValues));
        });

        return result;
    }

    prepareHeatmapData(filteredData) {
        const data = filteredData.length > 0 ? filteredData : this.dataLoader.data.wide;
        if (!data) return { z: [], x: [], y: [] };

        const indices = ['NDVI', 'NBR', 'EVI', 'BAI', 'NDWI', 'SAVI'];
        const polygons = data.slice(0, 20).map(row => ({
            id: row.fire_id,
            name: row.frname || `Полигон ${row.fire_id}`
        }));

        const z = polygons.map(polygon => {
            const row = data.find(r => r.fire_id === polygon.id);
            if (!row) return indices.map(() => null);
            return indices.map(index => {
                const key = `${index}_median`;
                return row[key] !== undefined ? row[key] : null;
            });
        });

        return { z, x: indices, y: polygons.map(p => p.name) };
    }

    prepareNDVIClassesData(filteredData) {
        const data = filteredData.length > 0 ? filteredData : this.dataLoader.data.wide;
        if (!data || data.length === 0) return { labels: [], values: [] };

        const labels = [
            'Класс 0', 'Класс 1', 'Класс 2', 'Класс 3', 'Класс 4',
            'Класс 5', 'Класс 6', 'Класс 7', 'Класс 8', 'Класс 9',
            'Класс 10', 'Класс 11', 'Класс 12'
        ];

        let targetRow;
        if (this.currentFilters.fireId) {
            targetRow = data.find(r => r.fire_id === this.currentFilters.fireId);
        } else {
            targetRow = {};
            labels.forEach((_, i) => {
                const key = `ndvi_class_${i}_ha`;
                targetRow[key] = data.reduce((sum, row) => sum + (row[key] || 0), 0) / data.length;
            });
        }

        if (!targetRow) return { labels, values: [] };

        const values = labels.map((_, i) => {
            const key = `ndvi_class_${i}_ha`;
            return targetRow[key] || 0;
        });

        return { labels, values };
    }

    prepareVegetationStatusData(filteredData) {
        const data = filteredData.length > 0 ? filteredData : this.dataLoader.data.wide;
        if (!data) return [];

        const sorted = [...data].sort((a, b) => b.Area - a.Area).slice(0, 10);
        
        return sorted.map(row => ({
            name: row.frname || `Полигон ${row.fire_id}`,
            degraded: row.degraded_ha || 0,
            healthy: row.healthy_ha || 0,
            total: row.Area || 0
        }));
    }

    prepareOverallTrend(indexName = 'NDVI') {
        const data = this.dataLoader.data.viByYear;
        if (!data) return { dates: [], values: [] };

        const sorted = [...data].sort((a, b) => a.year - b.year);
        const key = `${indexName}_median`;
        
        return {
            dates: sorted.map(row => row.year.toString()),
            values: sorted.map(row => row[key] !== undefined ? row[key] : null)
        };
    }

}

// CHART MANAGER
class ChartManager {
    constructor() {
        this.charts = {};
        this.colors = {
            NDVI: '#1a9850',
            NBR: '#d73027',
            EVI: '#2b83ba',
            BAI: '#fdae61',
            NDWI: '#66c2a5',
            SAVI: '#8da0cb',
            NBR2: '#e78ac3'
        };
    }

        renderTimeSeries(containerId, data, indexName = 'NDVI') {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.dates.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const traceMain = {
            x: data.dates,
            y: data.values,
            type: 'scatter',
            mode: 'lines+markers',
            name: `${indexName} (медиана)`,
            line: { color: this.colors[indexName] || '#666', width: 3 },
            marker: { size: 8, color: this.colors[indexName] || '#666' },
            hovertemplate: '<b>%{x}</b><br>Значение: %{y:.3f}<extra></extra>'
        };

        const traces = [traceMain];
        
        if (data.minValues && data.minValues.length > 0) {
            const traceMin = {
                x: data.dates,
                y: data.minValues,
                type: 'scatter',
                mode: 'lines',
                name: 'Минимум',
                line: { color: 'rgba(0,0,0,0.1)', width: 0 },
                showlegend: false
            };
            const traceMax = {
                x: data.dates,
                y: data.maxValues,
                type: 'scatter',
                mode: 'lines',
                name: 'Максимум',
                fill: 'tonexty',
                fillcolor: 'rgba(100,100,100,0.15)',
                line: { color: 'rgba(0,0,0,0.1)', width: 0 },
                showlegend: false
            };
            traces.unshift(traceMin, traceMax);
        }

        const layout = {
            title: `Динамика индекса ${indexName}`,
            xaxis: { 
                title: 'Год',
                tickangle: -45,
                gridcolor: '#e0e0e0',
                type: 'category'
            },
            yaxis: {
                title: 'Значение индекса',
                range: [-0.5, 1],
                gridcolor: '#e0e0e0',
                zeroline: true
            },
            hovermode: 'x unified',
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 60, r: 30, b: 70 },
            legend: { orientation: 'h', y: 1.05 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            traces,
            layout,
            { responsive: true }
        );
    }

    renderHeatmap(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.z.length === 0 || data.x.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const trace = {
            z: data.z,
            x: data.x,
            y: data.y,
            type: 'heatmap',
            colorscale: [
                [0, '#d73027'],
                [0.33, '#fc8d59'],
                [0.66, '#fee08b'],
                [1, '#1a9850']
            ],
            zsmooth: 'best',
            hovertemplate: 
                '<b>Полигон:</b> %{y}<br>' +
                '<b>Индекс:</b> %{x}<br>' +
                '<b>Значение:</b> %{z:.3f}<br>' +
                '<extra></extra>'
        };

        const layout = {
            title: 'Средние значения индексов по полигонам',
            xaxis: { title: 'Вегетационные индексы' },
            yaxis: { title: 'Полигоны' },
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 120, r: 30, b: 50 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            [trace],
            layout,
            { responsive: true }
        );
    }
    renderNDVIClasses(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.values.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const colors = data.values.map(v => {
            if (v < 10) return '#d73027';
            if (v < 30) return '#fc8d59';
            if (v < 50) return '#fee08b';
            if (v < 70) return '#d9ef8b';
            return '#1a9850';
        });

        const trace = {
            x: data.labels,
            y: data.values,
            type: 'bar',
            marker: { color: colors },
            hovertemplate: '<b>%{x}</b><br>Площадь: %{y:.1f} га<extra></extra>'
        };

        const layout = {
            title: 'Распределение NDVI классов',
            xaxis: { 
                title: 'Классы NDVI',
                tickangle: -45
            },
            yaxis: { title: 'Площадь, га' },
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 60, r: 30, b: 70 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            [trace],
            layout,
            { responsive: true }
        );
    }

     renderVegetationStatus(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const trace1 = {
            x: data.map(d => d.name),
            y: data.map(d => d.degraded),
            name: 'Деградированная',
            type: 'bar',
            marker: { color: '#d73027' },
            hovertemplate: '<b>%{x}</b><br>Деградированная: %{y:.1f} га<extra></extra>'
        };

        const trace2 = {
            x: data.map(d => d.name),
            y: data.map(d => d.healthy),
            name: 'Здоровая',
            type: 'bar',
            marker: { color: '#1a9850' },
            hovertemplate: '<b>%{x}</b><br>Здоровая: %{y:.1f} га<extra></extra>'
        };

        const layout = {
            title: 'Состояние растительности по полигонам',
            xaxis: { title: 'Полигоны', tickangle: -45 },
            yaxis: { title: 'Площадь, га' },
            barmode: 'stack',
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 60, r: 30, b: 70 },
            legend: { orientation: 'h', y: 1.05 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            [trace1, trace2],
            layout,
            { responsive: true }
        );
    }

    renderOverallTrend(containerId, data, indexName = 'NDVI') {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.dates.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const trace = {
            x: data.dates,
            y: data.values,
            type: 'scatter',
            mode: 'lines+markers',
            name: `${indexName} (средний)`,
            line: { color: this.colors[indexName] || '#666', width: 3 },
            marker: { size: 6, color: this.colors[indexName] || '#666' },
            hovertemplate: '<b>%{x}</b><br>Среднее: %{y:.3f}<extra></extra>'
        };

        const layout = {
            title: `Общий тренд индекса ${indexName}`,
            xaxis: { 
                title: 'Год',
                tickangle: -45,
                gridcolor: '#e0e0e0'
            },
            yaxis: {
                title: 'Среднее значение',
                range: [-0.5, 1],
                gridcolor: '#e0e0e0',
                zeroline: true
            },
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 60, r: 30, b: 70 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            [trace],
            layout,
            { responsive: true }
        );
    }
    renderOverallTrend(containerId, data, indexName = 'NDVI') {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!data || data.dates.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Нет данных для отображения</p>';
            return;
        }

        const trace = {
            x: data.dates,
            y: data.values,
            type: 'scatter',
            mode: 'lines+markers',
            name: `${indexName} (средний)`,
            line: { color: this.colors[indexName] || '#666', width: 3 },
            marker: { size: 6, color: this.colors[indexName] || '#666' },
            hovertemplate: '<b>%{x}</b><br>Среднее: %{y:.3f}<extra></extra>'
        };

        const layout = {
            title: `Общий тренд индекса ${indexName}`,
            xaxis: { 
                title: 'Год',
                tickangle: -45,
                gridcolor: '#e0e0e0'
            },
            yaxis: {
                title: 'Среднее значение',
                range: [-0.5, 1],
                gridcolor: '#e0e0e0',
                zeroline: true
            },
            plot_bgcolor: '#f8f9fa',
            paper_bgcolor: '#ffffff',
            margin: { t: 50, l: 60, r: 30, b: 70 }
        };

        this.charts[containerId] = Plotly.newPlot(
            containerId,
            [trace],
            layout,
            { responsive: true }
        );
    }

     updateAllCharts(filteredData, filters, dataFilter) {
        const indexName = filters.indexName || 'NDVI';
        
        // 1. Линейный график
        const timeData = dataFilter.prepareTimeSeriesByYear(filteredData, indexName);
        this.renderTimeSeries('timeSeriesChart', timeData, indexName);

        // 2. Тепловая матрица
        const heatData = dataFilter.prepareHeatmapData(filteredData);
        this.renderHeatmap('heatmapChart', heatData);

        // 3. NDVI классы
        const classData = dataFilter.prepareNDVIClassesData(filteredData);
        this.renderNDVIClasses('ndviClassesChart', classData);

        // 4. Состояние растительности
        const statusData = dataFilter.prepareVegetationStatusData(filteredData);
        this.renderVegetationStatus('vegetationStatusChart', statusData);

        // 5. Общий тренд
        if (!filters.fireId) {
            const trendData = dataFilter.prepareOverallTrend(indexName);
            this.renderOverallTrend('overallTrendChart', trendData, indexName);
        } else {
            const container = document.getElementById('overallTrendChart');
            if (container) {
                container.innerHTML = '<p style="text-align:center;color:#999;padding:50px;">Выберите "Все полигоны" для отображения общего тренда</p>';
            }
        }
    }
}
if (typeof window !== 'undefined') {
    window.DataLoader = DataLoader;
    window.DataFilter = DataFilter;
    window.ChartManager = ChartManager;
    console.log('Классы экспортированы в window');
}
