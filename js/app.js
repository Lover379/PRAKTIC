
// DATA LOADER
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
            console.log('✅ Все данные загружены!');
            console.log(`📊 wide: ${wide ? wide.length : 0} записей`);
            console.log(`📊 stats: ${stats ? stats.length : 0} записей`);
            
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


// DATA FILTER
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
}
