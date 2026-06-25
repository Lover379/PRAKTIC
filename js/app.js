//  DATA LOADER 

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
