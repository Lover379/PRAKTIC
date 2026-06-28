// js/main.js

console.log(' Проверка зависимостей:');
console.log('DataLoader:', typeof DataLoader);
console.log('DataFilter:', typeof DataFilter);
console.log('ChartManager:', typeof ChartManager);
console.log('Papa:', typeof Papa);
console.log('Plotly:', typeof Plotly);

// Проверяем, что классы загружены
if (typeof DataLoader === 'undefined' || 
    typeof DataFilter === 'undefined' || 
    typeof ChartManager === 'undefined') {
    console.error(' Классы из app.js не загружены!');
    alert('Ошибка: не удалось загрузить app.js.');
}


const dataLoader = new DataLoader();
const dataFilter = new DataFilter(dataLoader);
const chartManager = new ChartManager();

let appState = {
    filters: { indexName: 'NDVI' },
    data: null,
    isInitialized: false
};


// ОСНОВНЫЕ ФУНКЦИИ

async function initApp() {
    try {
        console.log(' Запуск приложения...');
        showLoading(true);
        
        await dataLoader.loadAllData();
        
        populateFilters();
        updateDashboard();
        
        appState.isInitialized = true;
        showLoading(false);
        
        console.log(' Дашборд загружен успешно!');
        console.log(` Доступно полигонов: ${dataLoader.getPolygons().length}`);
        
    } catch (error) {
        console.error(' Ошибка инициализации:', error);
        showLoading(false);
        alert('Не удалось загрузить данные. Проверьте консоль (F12).');
    }
}

function populateFilters() {
    // Полигоны
    const polygons = dataLoader.getPolygons();
    const polygonSelect = document.getElementById('polygonFilter');
    if (polygonSelect) {
        polygonSelect.innerHTML = '<option value="">Все полигоны</option>';
        polygons.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = `${p.id} (${Math.round(p.area)} га)`;
            polygonSelect.appendChild(option);
        });
    }

    // Годы
    const years = dataLoader.getYearRange();
    const yearSelect = document.getElementById('yearFilter');
    if (yearSelect) {
        yearSelect.innerHTML = '<option value="">Все годы</option>';
        for (let y = years.min; y <= years.max; y++) {
            const option = document.createElement('option');
            option.value = y;
            option.textContent = y;
            yearSelect.appendChild(option);
        }
    }

    // Типы растительности
    const vegTypes = [
        'Вечнозелёные хвойные леса', 
        'Листопадные хвойные леса', 
        'Листопадные широколиственные леса', 
        'Смешанные леса', 
        'Закрытые кустарники', 
        'Открытые кустарники', 
        'Лесистые саванны', 
        'Саванны', 
        'Луга и пастбища'
    ];
    const vegSelect = document.getElementById('vegTypeFilter');
    if (vegSelect) {
        vegSelect.innerHTML = '<option value="">Все типы</option>';
        vegTypes.forEach(t => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = t;
            vegSelect.appendChild(option);
        });
    }
}

function updateDashboard() {
    const filters = getCurrentFilters();
    appState.filters = filters;
    
    console.log(' Применяем фильтры:', filters);
    
    const filteredData = dataFilter.applyFilters(filters);
    console.log(` Отфильтровано записей: ${filteredData.length}`);
    
    chartManager.updateAllCharts(filteredData, filters, dataFilter);
}

function getCurrentFilters() {
    return {
        fireId: document.getElementById('polygonFilter')?.value || null,
        year: document.getElementById('yearFilter')?.value || null,
        indexName: document.getElementById('indexFilter')?.value || 'NDVI',
        period: document.getElementById('periodFilter')?.value || null,
        vegType: document.getElementById('vegTypeFilter')?.value || null,
        areaMin: document.getElementById('areaMinFilter')?.value || null,
        areaMax: document.getElementById('areaMaxFilter')?.value || null
    };
}

// ОБРАБОТЧИКИ СОБЫТИЙ

function setupEventListeners() {
    const filterIds = ['polygonFilter', 'yearFilter', 'indexFilter', 
                      'periodFilter', 'vegTypeFilter', 'areaMinFilter', 'areaMaxFilter'];
    
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                console.log(`🔄 Изменен фильтр: ${id} = ${el.value}`);
                updateDashboard();
            });
        }
    });

    // Клик по графику
    const chartContainer = document.getElementById('timeSeriesChart');
    if (chartContainer) {
        chartContainer.addEventListener('plotly_click', function(data) {
            const point = data.points[0];
            if (point) {
                const year = point.x;
                const yearSelect = document.getElementById('yearFilter');
                if (yearSelect) {
                    yearSelect.value = year;
                    updateDashboard();
                }
            }
        });
    }

    // Кнопка сброса
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            document.querySelectorAll('.filter-group select').forEach(select => {
                if (select.id !== 'indexFilter') {
                    select.value = '';
                }
            });
            const indexSelect = document.getElementById('indexFilter');
            if (indexSelect) indexSelect.value = 'NDVI';
            updateDashboard();
        });
    }

    console.log(' Обработчики событий настроены');
}

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

function showLoading(show) {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
    }
}

// =====================================================
// ЭКСПОРТ
// =====================================================

window.dashboard = {
    updateDashboard: updateDashboard,
    getCurrentFilters: getCurrentFilters,
    dataLoader: dataLoader,
    dataFilter: dataFilter,
    chartManager: chartManager
};

window.updateDashboard = updateDashboard;
window.getCurrentFilters = getCurrentFilters;
window.dataLoader = dataLoader;
window.dataFilter = dataFilter;

// =====================================================
// ЗАПУСК
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log(' DOM загружен');
    setupEventListeners();
    initApp();
});