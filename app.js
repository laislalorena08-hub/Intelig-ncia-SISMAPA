// -------------------------------------------------------------
// APP STATE & CONFIGURATION
// -------------------------------------------------------------
let db = { reports: [] };
let selectedReport = null;
let previousReport = null;
let activeTheme = 'dark-theme';

// Paginação para a Tabela de Municípios
let currentPage = 1;
const pageSize = 15;
let currentKpiFilter = null; // 'all', 'Vigente', 'Próximo do Vencimento', 'Vencido', 'Alterado', 'Novo', 'Removido'

// Série histórica calculada (Competências Mensais)
let historyData = {
    labels: [], // ex: ["Março", "Abril", "Maio", "Junho"]
    dates: [],  // ex: ["13/03/2026", "27/04/2026", ...]
    munsCount: [],
    igrsCount: [],
    entradas: [],
    saidas: [],
    revalidacoes: [],
    igrStability: {}, // Contagem de modificações por IGR
    munHistory: {},   // Histórico cronológico de cada município
    reportsChanges: [] // Log de mudanças de cada relatório
};

const portugueseMonths = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Posições aproximadas geográficas das IGRs para o mapa interativo
const igrGeographies = {
    "Polo Turístico do Oeste Potiguar": { x: 140, y: 160, r: 45, labelPos: {x: 140, y: 160} },
    "IGR Rota do Frio": { x: 220, y: 250, r: 35, labelPos: {x: 220, y: 250} },
    "IGR Costa Branca": { x: 280, y: 90, r: 42, labelPos: {x: 280, y: 90} },
    "POLO VALE MAR": { x: 380, y: 140, r: 38, labelPos: {x: 380, y: 140} },
    "IGR DO SERTÃO PARA O MAR": { x: 480, y: 80, r: 35, labelPos: {x: 480, y: 80} },
    "IGR CABUGI CENTRAL": { x: 480, y: 190, r: 36, labelPos: {x: 480, y: 190} },
    "IGR Seridó": { x: 420, y: 280, r: 48, labelPos: {x: 420, y: 280} },
    "IGR CAMINHOS DO POTENGI": { x: 590, y: 150, r: 38, labelPos: {x: 590, y: 150} },
    "IGR Trairi": { x: 570, y: 240, r: 36, labelPos: {x: 570, y: 240} },
    "ASSOCIAÇÃO DOS MUNICIPIOS DA REGIÃO SERRANA DO AGRESTE POTIGUAR - AMSAP": { x: 650, y: 300, r: 32, labelPos: {x: 650, y: 300} },
    "IGR Costa das Dunas": { x: 690, y: 180, r: 52, labelPos: {x: 690, y: 180} }
};

// -------------------------------------------------------------
// LIFE CYCLE EVENTS
// -------------------------------------------------------------
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

function initApp() {
    // 1. Carregar banco de dados
    if (window.dashboardData && window.dashboardData.reports && window.dashboardData.reports.length > 0) {
        db = window.dashboardData;
    } else {
        console.warn("Base histórica não encontrada.");
        alert("Atenção: A base de dados (data/database.js) não foi carregada.\n\nPara visualizar o painel com dados, certifique-se de que:\n1. A pasta 'data' está no mesmo diretório de 'index.html'\n2. O arquivo 'database.js' está dentro da pasta 'data'\n3. Se você estiver abrindo o arquivo localmente, recarregue a página com Ctrl + F5.");
        return;
    }

    // Ordenar relatórios cronologicamente pela data de geração (segurança extra)
    db.reports.sort((a, b) => {
        const dateA = parseDateStr(a.generation_date.split(' ')[0]);
        const dateB = parseDateStr(b.generation_date.split(' ')[0]);
        return dateA - dateB;
    });

    // 2. Processar Série Histórica
    processHistoricalData();

    // 3. Setup Event Listeners
    setupEventListeners();

    // 4. Carregar Seletores
    populateReportSelector();

    // 5. Selecionar o relatório mais recente por padrão
    const selector = document.getElementById("report-selector");
    if (selector.options.length > 0) {
        selector.value = selector.options[selector.options.length - 1].value;
    }
    selectReportFromDropdown();
}

function setupEventListeners() {
    // Menu Tabs switching
    document.querySelectorAll(".menu-item").forEach(button => {
        button.addEventListener("click", (e) => {
            const tabId = e.currentTarget.getAttribute("data-tab");
            switchTab(tabId);
        });
    });

    // Theme toggle
    document.getElementById("theme-toggle-btn").addEventListener("click", toggleTheme);

    // Dropdown change
    document.getElementById("report-selector").addEventListener("change", selectReportFromDropdown);

    // Search and Filters in Table
    document.getElementById("table-search").addEventListener("input", () => { currentPage = 1; filterTableData(); });
    document.getElementById("filter-igr").addEventListener("change", () => { currentPage = 1; filterTableData(); });
    document.getElementById("filter-status").addEventListener("change", () => { currentPage = 1; filterTableData(); });
    
    // Clear Filters
    document.getElementById("btn-clear-table-filters").addEventListener("click", clearTableFilters);

    // Export Table
    document.getElementById("btn-export-csv").addEventListener("click", exportTableToCSV);

    // Modal Control
    const uploadModal = document.getElementById("upload-modal");
    document.getElementById("btn-import-simulated").addEventListener("click", () => {
        uploadModal.classList.add("active");
    });
    document.getElementById("modal-close-btn").addEventListener("click", () => {
        uploadModal.classList.remove("active");
    });
    
    // History Modal Close
    const historyModal = document.getElementById("history-modal");
    document.getElementById("history-modal-close").addEventListener("click", () => {
        historyModal.classList.remove("active");
    });

    // Close Modals on click outside
    window.addEventListener("click", (e) => {
        if (e.target === uploadModal) uploadModal.classList.remove("active");
        if (e.target === historyModal) historyModal.classList.remove("active");
    });

    // Copy command
    document.getElementById("btn-copy-cmd").addEventListener("click", () => {
        const text = document.getElementById("terminal-command-text").innerText;
        navigator.clipboard.writeText(text);
        alert("Comando copiado para a área de transferência!");
    });

    // Simulated Imports
    document.getElementById("btn-sim-normal").addEventListener("click", () => {
        // Restaurar base inicial de 4 relatórios reais
        if (window.dashboardData && window.dashboardData.reports) {
            db = window.dashboardData;
        } else {
            db = getMockDatabase();
        }
        db.reports = db.reports.filter(r => !r.generation_date.includes("20/07/2026"));
        
        processHistoricalData();
        populateReportSelector();
        const sel = document.getElementById("report-selector");
        sel.value = sel.options[sel.options.length - 1].value;
        selectReportFromDropdown();
        uploadModal.classList.remove("active");
        alert("Série cronológica real de 4 competências mensais carregada.");
    });

    document.getElementById("btn-sim-changes").addEventListener("click", () => {
        // Injetar uma competência fictícia de Julho para simulação
        simulateWeek5Carga();
        processHistoricalData();
        populateReportSelector();
        const sel = document.getElementById("report-selector");
        sel.value = sel.options[sel.options.length - 1].value;
        selectReportFromDropdown();
        uploadModal.classList.remove("active");
        alert("Simulação de competência do mês de Julho carregada! Verifique os novos alertas de descredenciamento na aba Evolução Histórica.");
    });

    // KPI click handlers
    document.getElementById("kpi-muns").addEventListener("click", () => applyKpiFilter("all"));
    document.getElementById("kpi-active").addEventListener("click", () => applyKpiFilter("Vigente"));
    document.getElementById("kpi-warning").addEventListener("click", () => applyKpiFilter("Próximo do Vencimento"));
    document.getElementById("kpi-danger").addEventListener("click", () => applyKpiFilter("Vencido"));
    document.getElementById("kpi-changes").addEventListener("click", () => applyKpiFilter("Alterado"));
    
    // IGR details inner filter
    document.getElementById("sel-region-days-filter").addEventListener("change", renderSelectedIgrMunsList);

    // Action buttons inside Executive Document
    document.getElementById("btn-copy-report").addEventListener("click", copyExecutiveReportText);
    document.getElementById("btn-print-report").addEventListener("click", () => {
        window.print();
    });
}

// -------------------------------------------------------------
// TAB CONTROL & THEME
// -------------------------------------------------------------
function switchTab(tabId) {
    document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.remove("active");
    });
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(btn => {
        btn.classList.remove("active");
    });

    document.getElementById(tabId).classList.add("active");
    
    const activeBtn = document.querySelector(`.sidebar-menu [data-tab="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    if (tabId === 'tab-history') {
        renderHistoryCharts();
        renderHistoryRankings();
    }
}

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById("theme-toggle-btn");
    
    if (body.classList.contains("dark-theme")) {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
        btn.innerHTML = `<i class="fa-solid fa-moon"></i> <span>Modo Escuro</span>`;
        activeTheme = 'light-theme';
    } else {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
        btn.innerHTML = `<i class="fa-solid fa-sun"></i> <span>Modo Claro</span>`;
        activeTheme = 'dark-theme';
    }
    
    renderRiskMap();
    if (document.getElementById("tab-history").classList.contains("active")) {
        renderHistoryCharts();
    }
}

// -------------------------------------------------------------
// HISTORICAL DATA PROCESSOR (Série Histórica por Semanas)
// -------------------------------------------------------------
function processHistoricalData() {
    historyData = {
        labels: [],
        dates: [],
        munsCount: [],
        igrsCount: [],
        entradas: [],
        saidas: [],
        revalidacoes: [],
        igrStability: {},
        munHistory: {},
        reportsChanges: []
    };

    db.reports.forEach(report => {
        report.data.IGRs.forEach(igr => {
            if (!historyData.igrStability[igr.name]) {
                historyData.igrStability[igr.name] = { entries: 0, exits: 0, valChanges: 0, totalChanges: 0 };
            }
        });
    });

    db.reports.forEach((report, reportIdx) => {
        const rDate = report.generation_date.split(' ')[0];
        const dateParts = rDate.split('/');
        const monthIndex = parseInt(dateParts[1]) - 1;
        const rLabel = portugueseMonths[monthIndex];
        
        historyData.labels.push(rLabel);
        historyData.dates.push(rDate);

        let munsInReport = 0;
        report.data.IGRs.forEach(igr => munsInReport += igr.municipalities.length);
        
        historyData.munsCount.push(munsInReport);
        historyData.igrsCount.push(report.data.IGRs.length);

        const currentMunsMap = {};
        report.data.IGRs.forEach(igr => {
            igr.municipalities.forEach(mun => {
                currentMunsMap[mun.name] = { igr: igr.name, validity: mun.validity };
                
                if (!historyData.munHistory[mun.name]) {
                    historyData.munHistory[mun.name] = [];
                }
                
                const status = getMunicipalityStatus(mun.validity, report.generation_date);
                historyData.munHistory[mun.name].push({
                    reportDate: rLabel,
                    validity: mun.validity,
                    igr: igr.name,
                    status: status,
                    event: reportIdx === 0 ? 'registro_inicial' : 'vigente'
                });
            });
        });

        let ent = 0;
        let sai = 0;
        let rev = 0;
        const reportChangesLog = [];

        if (reportIdx > 0) {
            const prevReport = db.reports[reportIdx - 1];
            const prevMunsMap = {};
            prevReport.data.IGRs.forEach(igr => {
                igr.municipalities.forEach(mun => {
                    prevMunsMap[mun.name] = { igr: igr.name, validity: mun.validity };
                });
            });

            // Entradas e Revalidações na Semana
            for (const [name, info] of Object.entries(currentMunsMap)) {
                if (!prevMunsMap[name]) {
                    ent++;
                    const hist = historyData.munHistory[name];
                    hist[hist.length - 1].event = 'entrada';
                    
                    historyData.igrStability[info.igr].entries++;
                    historyData.igrStability[info.igr].totalChanges++;
                    
                    reportChangesLog.push({
                        type: 'entrada',
                        text: `Município <strong>${name}</strong> ingressou na IGR <strong>${info.igr}</strong> no mês de ${rLabel}.`
                    });
                } else {
                    const prevInfo = prevMunsMap[name];
                    if (prevInfo.validity !== info.validity) {
                        rev++;
                        const hist = historyData.munHistory[name];
                        hist[hist.length - 1].event = 'revalidacao';
                        
                        historyData.igrStability[info.igr].valChanges++;
                        historyData.igrStability[info.igr].totalChanges++;
                        
                        reportChangesLog.push({
                            type: 'revalidação',
                            text: `Vigência de <strong>${name}</strong> prorrogada de ${prevInfo.validity || 'Sem Vigência'} para ${info.validity || 'Sem Vigência'} no mês de ${rLabel}.`
                        });
                    }
                    if (prevInfo.igr !== info.igr) {
                        historyData.igrStability[info.igr].totalChanges++;
                        historyData.igrStability[prevInfo.igr].totalChanges++;
                        
                        reportChangesLog.push({
                            type: 'transferência',
                            text: `<strong>${name}</strong> transferido da IGR ${prevInfo.igr} para ${info.igr} no mês de ${rLabel}.`
                        });
                    }
                }
            }

            // Saídas no Mês
            for (const [name, info] of Object.entries(prevMunsMap)) {
                if (!currentMunsMap[name]) {
                    sai++;
                    
                    if (!historyData.munHistory[name]) historyData.munHistory[name] = [];
                    historyData.munHistory[name].push({
                        reportDate: rLabel,
                        validity: "",
                        igr: info.igr,
                        status: "Removido",
                        event: 'saida'
                    });

                    historyData.igrStability[info.igr].exits++;
                    historyData.igrStability[info.igr].totalChanges++;
                    
                    reportChangesLog.push({
                        type: 'saida',
                        text: `Município <strong>${name}</strong> desvinculado da IGR <strong>${info.igr}</strong> no mês de ${rLabel}.`
                    });
                }
            }
        }

        historyData.entradas.push(ent);
        historyData.saidas.push(sai);
        historyData.revalidacoes.push(rev);
        historyData.reportsChanges.push(reportChangesLog);
    });
}

// -------------------------------------------------------------
// SELECTOR AND DATA MANAGEMENT
// -------------------------------------------------------------
function populateReportSelector() {
    const selector = document.getElementById("report-selector");
    selector.innerHTML = "";
    
    db.reports.forEach((report, index) => {
        const option = document.createElement("option");
        option.value = index;
        
        const dateParts = report.generation_date.split(' ')[0].split('/');
        const monthName = portugueseMonths[parseInt(dateParts[1]) - 1];
        
        let label = `Competência ${monthName} / ${dateParts[2]}`;
        if (index === db.reports.length - 1) {
            label += " [Mais Recente]";
        }
        option.text = label;
        selector.appendChild(option);
    });
}

function selectReportFromDropdown() {
    const selector = document.getElementById("report-selector");
    const index = parseInt(selector.value);
    
    if (isNaN(index) || index < 0 || index >= db.reports.length) return;
    
    selectedReport = db.reports[index];
    previousReport = index > 0 ? db.reports[index - 1] : null;

    currentKpiFilter = null;
    document.querySelectorAll(".kpi-card").forEach(c => c.classList.remove("selected-kpi-filter"));
    document.getElementById("active-kpi-filter-indicator").style.display = "none";
    document.getElementById("btn-clear-table-filters").style.display = "none";

    currentPage = 1;
    updateUI();
}

// -------------------------------------------------------------
// CORE RENDERING & UI UPDATES
// -------------------------------------------------------------
function updateUI() {
    if (!selectedReport) return;

    updateKPICards();
    renderIgrSizeChart();
    renderValidityDistribution();
    renderAlertsFeeds();
    renderRiskMap();
    populateMunicipalitiesTable();
    renderExecutiveDocument();
    updateAlertBadges();
}

function updateKPICards() {
    const data = selectedReport.data;
    
    let totalMuns = 0;
    let vigentes = 0;
    let atencao = 0;
    let vencidos = 0;
    
    data.IGRs.forEach(igr => {
        igr.municipalities.forEach(mun => {
            totalMuns++;
            const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
            if (status === "Vigente") vigentes++;
            else if (status === "Próximo do Vencimento") atencao++;
            else if (status === "Vencido") vencidos++;
        });
    });

    document.getElementById("kpi-muns-val").innerText = totalMuns;
    document.getElementById("kpi-igrs-val").innerText = data.IGRs.length;
    document.getElementById("kpi-active-val").innerText = vigentes;
    document.getElementById("kpi-warning-val").innerText = atencao;
    document.getElementById("kpi-danger-val").innerText = vencidos;
    
    const rIndex = db.reports.indexOf(selectedReport);
    const changesCount = rIndex >= 0 ? historyData.revalidacoes[rIndex] : 0;
    document.getElementById("kpi-changes-val").innerText = changesCount;

    const pctVig = totalMuns > 0 ? Math.round((vigentes / totalMuns) * 100) : 0;
    document.getElementById("kpi-active-pct").innerText = `${pctVig}% do total`;

    const trendMuns = document.getElementById("kpi-muns-trend");
    const trendIgrs = document.getElementById("kpi-igrs-trend");

    if (previousReport) {
        let prevMuns = 0;
        previousReport.data.IGRs.forEach(igr => prevMuns += igr.municipalities.length);
        
        const diffMuns = totalMuns - prevMuns;
        if (diffMuns > 0) {
            trendMuns.className = "kpi-trend up";
            trendMuns.innerHTML = `<i class="fa-solid fa-arrow-up"></i> +${diffMuns} no mês`;
        } else if (diffMuns < 0) {
            trendMuns.className = "kpi-trend down";
            trendMuns.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${diffMuns} no mês`;
        } else {
            trendMuns.className = "kpi-trend text-muted";
            trendMuns.innerHTML = `<i class="fa-solid fa-minus"></i> Estável`;
        }

        const diffIgrs = data.IGRs.length - previousReport.data.IGRs.length;
        if (diffIgrs > 0) {
            trendIgrs.className = "kpi-trend up";
            trendIgrs.innerHTML = `<i class="fa-solid fa-arrow-up"></i> +${diffIgrs} no mês`;
        } else if (diffIgrs < 0) {
            trendIgrs.className = "kpi-trend down";
            trendIgrs.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${diffIgrs} no mês`;
        } else {
            trendIgrs.className = "kpi-trend text-muted";
            trendIgrs.innerHTML = `<i class="fa-solid fa-minus"></i> Estável`;
        }
    } else {
        trendMuns.className = "kpi-trend text-muted";
        trendMuns.innerHTML = `<i class="fa-solid fa-minus"></i> Competência Inicial`;
        trendIgrs.className = "kpi-trend text-muted";
        trendIgrs.innerHTML = `<i class="fa-solid fa-minus"></i> Competência Inicial`;
    }
}

function renderIgrSizeChart() {
    const container = document.getElementById("igr-size-ranking");
    container.innerHTML = "";

    const igrSizes = selectedReport.data.IGRs.map(igr => {
        return { name: igr.name, count: igr.municipalities.length };
    });

    igrSizes.sort((a, b) => b.count - a.count);
    const maxCount = igrSizes.length > 0 ? igrSizes[0].count : 1;

    igrSizes.forEach(igr => {
        const pct = (igr.count / maxCount) * 100;
        
        const row = document.createElement("div");
        row.className = "chart-bar-row";
        row.title = "Clique para detalhar esta IGR";
        row.addEventListener("click", () => {
            document.getElementById("filter-igr").value = igr.name;
            switchTab("tab-municipalities");
            filterTableData();
        });

        row.innerHTML = `
            <div class="bar-row-info">
                <span class="bar-label">${igr.name}</span>
                <span class="bar-value">${igr.count} municípios</span>
            </div>
            <div class="bar-wrapper">
                <div class="bar-fill" style="width: ${pct}%"></div>
            </div>
        `;
        container.appendChild(row);
    });
}

function renderValidityDistribution() {
    const container = document.getElementById("validity-distribution");
    container.innerHTML = "";

    let vigentes = 0;
    let atencao = 0;
    let vencidos = 0;

    selectedReport.data.IGRs.forEach(igr => {
        igr.municipalities.forEach(mun => {
            const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
            if (status === "Vigente") vigentes++;
            else if (status === "Próximo do Vencimento") atencao++;
            else if (status === "Vencido") vencidos++;
        });
    });

    const total = vigentes + atencao + vencidos;

    const items = [
        { status: "Vigente", class: "vigente", icon: "check", count: vigentes, desc: "Acesso regular ao turismo" },
        { status: "Em Alerta", class: "atencao", icon: "exclamation", count: atencao, desc: "Vence em até 90 dias" },
        { status: "Crítico (Vencido)", class: "vencido", icon: "xmark", count: vencidos, desc: "Bloqueados no SISMAPA" }
    ];

    items.forEach(item => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        
        const div = document.createElement("div");
        div.className = "validity-row";
        div.innerHTML = `
            <div class="val-status-circle ${item.class}"><i class="fa-solid fa-${item.icon}"></i></div>
            <div class="val-info">
                <span class="val-label">${item.status} (${pct}%)</span>
                <span class="val-subtext">${item.desc}</span>
            </div>
            <span class="val-count">${item.count}</span>
        `;
        container.appendChild(div);
    });
}

function renderAlertsFeeds() {
    const compactFeed = document.getElementById("overview-alerts-feed");
    const fullFeed = document.getElementById("alerts-feed-full-list");
    const valFeed = document.getElementById("validation-errors-feed");

    compactFeed.innerHTML = "";
    fullFeed.innerHTML = "";
    valFeed.innerHTML = "";

    const alerts = selectedReport.alerts || [];

    if (alerts.length === 0) {
        const noAlert = `<div class="alert-item alert-info">
            <div class="alert-item-icon"><i class="fa-solid fa-info-circle"></i></div>
            <div class="alert-item-content">
                <strong>Nenhum alerta crítico pendente nesta semana.</strong>
                <span>Todos os municípios e IGRs estão regulares.</span>
            </div>
        </div>`;
        compactFeed.innerHTML = noAlert;
        fullFeed.innerHTML = noAlert;
    } else {
        const priorityOrder = {
            "MUNICIPIO_VENCIDO": 1,
            "MUNICIPIO_VENCENDO_BREVE": 2,
            "MUNICIPIO_REMOVIDO": 3,
            "REGIAO_REMOVIDA": 4,
            "NOVO_MUNICIPIO": 5,
            "REGIAO_CRIADA": 6,
            "MUDANCA_REGIAO": 7,
            "ALTERACAO_VIGENCIA": 8,
            "REGIAO_REDUCAO_MUNICIPIOS": 9
        };

        const sortedAlerts = [...alerts].sort((a, b) => {
            const pA = priorityOrder[a.type] || 99;
            const pB = priorityOrder[b.type] || 99;
            return pA - pB;
        });

        sortedAlerts.forEach((alert, index) => {
            let alertClass = "alert-info";
            let icon = "info-circle";

            if (alert.type.includes("VENCIDO") || alert.type.includes("REMOVIDO")) {
                alertClass = "alert-danger";
                icon = "circle-xmark";
            } else if (alert.type.includes("BREVE") || alert.type.includes("REDUCAO")) {
                alertClass = "alert-warning";
                icon = "triangle-exclamation";
            } else if (alert.type.includes("NOVO") || alert.type.includes("CRIADA")) {
                alertClass = "alert-success";
                icon = "circle-check";
            }

            const alertHtml = `
                <div class="alert-item ${alertClass}">
                    <div class="alert-item-icon"><i class="fa-solid fa-${icon}"></i></div>
                    <div class="alert-item-content">
                        <strong>${alert.message}</strong>
                        <span class="alert-time">Competência de auditoria: ${selectedReport.read_date.split(' ')[0]}</span>
                    </div>
                </div>
            `;

            fullFeed.innerHTML += alertHtml;
            if (index < 5) {
                compactFeed.innerHTML += alertHtml;
            }
        });
    }

    const errors = selectedReport.validation_errors || [];

    if (errors.length === 0) {
        valFeed.innerHTML = `
            <div class="validation-log-item log-success">
                <i class="fa-solid fa-circle-check"></i>
                <div>
                    <strong>Dados íntegros nesta semana.</strong>
                    <span>Todas as métricas batem com os resumos oficiais e nenhuma duplicidade foi registrada.</span>
                </div>
            </div>
        `;
    } else {
        errors.forEach(err => {
            valFeed.innerHTML += `
                <div class="validation-log-item">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <div>
                        <strong>Inconsistência Registrada na Semana:</strong>
                        <span>${err}</span>
                    </div>
                </div>
            `;
        });
    }
}

// -------------------------------------------------------------
// MAP INTERACTIVE RENDER
// -------------------------------------------------------------
function renderRiskMap() {
    const svg = document.getElementById("rn-regions-svg");
    svg.innerHTML = "";

    const igrRiskMap = {};
    selectedReport.data.IGRs.forEach(igr => {
        igrRiskMap[igr.name] = {
            risk: calculateIgrRisk(igr),
            data: igr
        };
    });

    const isDark = document.body.classList.contains("dark-theme");
    const labelColor = isDark ? "#cbd5e1" : "#475569";

    const riskColors = {
        safe: "#10b981",
        moderate: "#0ea5e9",
        high: "#f59e0b",
        critical: "#ef4444"
    };

    for (const [name, geo] of Object.entries(igrGeographies)) {
        const info = igrRiskMap[name] || { risk: "safe", data: { municipalities: [] } };
        const color = riskColors[info.risk] || riskColors.safe;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", geo.x);
        circle.setAttribute("cy", geo.y);
        circle.setAttribute("r", geo.r);
        circle.setAttribute("fill", color);
        circle.setAttribute("fill-opacity", "0.15");
        circle.setAttribute("stroke", color);
        circle.setAttribute("stroke-width", "2.5");
        circle.setAttribute("style", "cursor: pointer; transition: all 0.3s;");
        
        circle.addEventListener("mouseenter", () => {
            circle.setAttribute("fill-opacity", "0.45");
            circle.setAttribute("stroke-width", "4");
        });
        circle.addEventListener("mouseleave", () => {
            circle.setAttribute("fill-opacity", "0.15");
            circle.setAttribute("stroke-width", "2.5");
        });

        circle.addEventListener("click", () => {
            displayRegionOnMapCard(name, info.data);
        });

        let shortName = name.replace("IGR ", "").replace("Polo Turístico do ", "").replace("POLO ", "");
        if (shortName.length > 15) shortName = shortName.split(" ")[0] + "...";
        if (name.includes("AMSAP")) shortName = "AMSAP";

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", geo.labelPos.x);
        text.setAttribute("y", geo.labelPos.y + 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", isDark ? "#ffffff" : "#0f172a");
        text.setAttribute("font-size", "10px");
        text.setAttribute("font-family", "var(--font-heading)");
        text.setAttribute("font-weight", "bold");
        text.setAttribute("style", "pointer-events: none; text-shadow: 0px 1px 2px rgba(0,0,0,0.5);");
        text.textContent = shortName;

        svg.appendChild(circle);
        svg.appendChild(text);
    }

    const watermark = document.createElementNS("http://www.w3.org/2000/svg", "text");
    watermark.setAttribute("x", "400");
    watermark.setAttribute("y", "380");
    watermark.setAttribute("text-anchor", "middle");
    watermark.setAttribute("fill", labelColor);
    watermark.setAttribute("fill-opacity", "0.1");
    watermark.setAttribute("font-size", "22px");
    watermark.setAttribute("font-family", "var(--font-heading)");
    watermark.setAttribute("font-weight", "800");
    watermark.setAttribute("letter-spacing", "6px");
    watermark.textContent = "RIO GRANDE DO NORTE";
    svg.insertBefore(watermark, svg.firstChild);
}

// -------------------------------------------------------------
// REGION PANEL WITH SELECTOR AND RISK SEMAPHORE
// -------------------------------------------------------------
function displayRegionOnMapCard(name, igrData) {
    selectedIgrName = name;
    selectedIgrData = igrData;

    const statsDiv = document.getElementById("sel-region-stats");
    const title = document.getElementById("sel-region-name");
    const riskPanel = document.getElementById("sel-region-risk-panel");

    title.innerText = name;
    statsDiv.style.display = "grid";
    riskPanel.style.display = "block";

    let total = igrData.municipalities.length;
    let vigentes = 0;
    let atencao = 0;
    let vencidos = 0;

    igrData.municipalities.forEach(mun => {
        const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
        if (status === "Vigente") vigentes++;
        else if (status === "Próximo do Vencimento") atencao++;
        else if (status === "Vencido") vencidos++;
    });

    document.getElementById("sel-region-total").innerText = total;
    document.getElementById("sel-region-vig").innerText = vigentes;
    document.getElementById("sel-region-warn").innerText = atencao;
    document.getElementById("sel-region-venc").innerText = vencidos;

    const riskCount = vencidos + atencao;
    const riskPct = total > 0 ? Math.round((riskCount / total) * 100) : 0;
    document.getElementById("sel-region-risk-pct").innerText = `${riskPct}%`;

    const semaphore = document.getElementById("sel-region-risk-semaphore");
    semaphore.className = "badge";
    
    if (vencidos > 0 && (vencidos / total) > 0.3) {
        semaphore.classList.add("risk-semaphore-red");
        semaphore.innerText = "🔴 Risco Crítico";
    } else if (vencidos > 0 || riskPct >= 20) {
        semaphore.classList.add("risk-semaphore-yellow");
        semaphore.innerText = "🟡 Médio Risco";
    } else {
        semaphore.classList.add("risk-semaphore-green");
        semaphore.innerText = "🟢 Baixo Risco";
    }

    renderSelectedIgrMunsList();

    document.getElementById("filter-igr").value = name;
    currentPage = 1;
    filterTableData();
}

function renderSelectedIgrMunsList() {
    if (!selectedIgrData) return;

    const listDiv = document.getElementById("sel-region-muns-list");
    const filterDays = document.getElementById("sel-region-days-filter").value;
    listDiv.innerHTML = "";

    let countShown = 0;

    selectedIgrData.municipalities.forEach(mun => {
        const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
        const days = getDaysRemaining(mun.validity, selectedReport.generation_date);
        
        let shouldShow = false;

        if (filterDays === "all") {
            shouldShow = true;
        } else if (filterDays === "expired") {
            shouldShow = status === "Vencido";
        } else {
            const maxDays = parseInt(filterDays);
            shouldShow = days !== -9999 && days >= 0 && days <= maxDays;
        }

        if (shouldShow) {
            countShown++;
            let badgeClass = "text-green";
            if (status === "Vencido") badgeClass = "text-red";
            else if (status === "Próximo do Vencimento") badgeClass = "text-yellow";

            const daysLabel = days === -9999 ? "Sem Vigência" : days < 0 ? `Vencido` : `${days} dias rest.`;

            const item = document.createElement("div");
            item.style.display = "flex";
            item.style.justifyContent = "space-between";
            item.style.padding = "4px 0";
            item.style.borderBottom = "1px solid rgba(128,128,128,0.1)";
            item.innerHTML = `
                <span style="font-weight:600; cursor:pointer;" onclick="openMunicipalityHistoryModal('${mun.name}')">${mun.name}</span>
                <span class="${badgeClass}" style="font-weight:bold; font-size:10px;">${daysLabel}</span>
            `;
            listDiv.appendChild(item);
        }
    });

    if (countShown === 0) {
        listDiv.innerHTML = `<div style="text-align:center; padding:10px; color:var(--text-muted);">Nenhum município nesta condição.</div>`;
    }
}

// -------------------------------------------------------------
// FILTER & PAGINATION FOR MUNICIPALITIES TABLE
// -------------------------------------------------------------
function populateMunicipalitiesTable() {
    const filterIgr = document.getElementById("filter-igr");
    const activeFilterValue = filterIgr.value;
    
    filterIgr.innerHTML = '<option value="">Todas as IGRs</option>';
    selectedReport.data.IGRs.forEach(igr => {
        const opt = document.createElement("option");
        opt.value = igr.name;
        opt.text = igr.name;
        filterIgr.appendChild(opt);
    });
    
    filterIgr.value = activeFilterValue;

    filteredList = [];
    selectedReport.data.IGRs.forEach(igr => {
        igr.municipalities.forEach(mun => {
            filteredList.push({
                name: mun.name,
                igr: igr.name,
                validity: mun.validity,
                is_new: mun.is_new
            });
        });
    });

    filterTableData();
}

function applyKpiFilter(filterType) {
    currentKpiFilter = filterType;

    document.querySelectorAll(".kpi-card").forEach(c => c.classList.remove("selected-kpi-filter"));
    
    let indicatorLabel = "Todos";
    let targetCardId = "kpi-muns";

    if (filterType === "Vigente") {
        targetCardId = "kpi-active";
        indicatorLabel = "Apenas Vigentes na Semana";
    } else if (filterType === "Próximo do Vencimento") {
        targetCardId = "kpi-warning";
        indicatorLabel = "Próximos do Vencimento na Semana";
    } else if (filterType === "Vencido") {
        targetCardId = "kpi-danger";
        indicatorLabel = "Apenas Vencidos na Semana";
    } else if (filterType === "Alterado") {
        targetCardId = "kpi-changes";
        indicatorLabel = "Vigências Alteradas na Semana";
    }

    document.getElementById(targetCardId).classList.add("selected-kpi-filter");

    const indicator = document.getElementById("active-kpi-filter-indicator");
    indicator.style.display = "inline-flex";
    indicator.innerText = `Filtro KPI: ${indicatorLabel}`;
    
    document.getElementById("btn-clear-table-filters").style.display = "inline-flex";

    switchTab("tab-municipalities");
    
    currentPage = 1;
    filterTableData();
}

function clearTableFilters() {
    currentKpiFilter = null;
    document.getElementById("table-search").value = "";
    document.getElementById("filter-igr").value = "";
    document.getElementById("filter-status").value = "";
    
    document.querySelectorAll(".kpi-card").forEach(c => c.classList.remove("selected-kpi-filter"));
    document.getElementById("active-kpi-filter-indicator").style.display = "none";
    document.getElementById("btn-clear-table-filters").style.display = "none";
    
    currentPage = 1;
    filterTableData();
}

function filterTableData() {
    const searchVal = document.getElementById("table-search").value.toLowerCase();
    const igrFilter = document.getElementById("filter-igr").value;
    const statusFilter = document.getElementById("filter-status").value;

    const tbody = document.getElementById("muns-table-body");
    tbody.innerHTML = "";

    const resultList = [];
    filteredList.forEach(mun => {
        const matchesSearch = mun.name.toLowerCase().includes(searchVal) || mun.igr.toLowerCase().includes(searchVal);
        const matchesIgr = igrFilter === "" || mun.igr === igrFilter;
        
        const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
        let matchesStatus = statusFilter === "" || status === statusFilter;

        let matchesKpi = true;
        if (currentKpiFilter && currentKpiFilter !== "all") {
            if (currentKpiFilter === "Alterado") {
                const summary = selectedReport.summary || {};
                const changedNames = (summary.changed_validity || []).map(x => x.name);
                matchesKpi = changedNames.includes(mun.name);
            } else {
                matchesKpi = status === currentKpiFilter;
            }
        }

        if (matchesSearch && matchesIgr && matchesStatus && matchesKpi) {
            resultList.push(mun);
        }
    });

    const totalRecords = resultList.length;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    
    if (currentPage > totalPages) currentPage = totalPages;
    
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedRecords = resultList.slice(startIndex, startIndex + pageSize);

    paginatedRecords.forEach(mun => {
        const days = getDaysRemaining(mun.validity, selectedReport.generation_date);
        const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
        
        let statusClass = "status-vigente";
        let daysText = days === -9999 ? "N/D" : `${days} dias`;
        
        if (status === "Vencido") {
            statusClass = "status-vencido";
            daysText = `Vencido há ${Math.abs(days)} dias`;
        } else if (status === "Próximo do Vencimento") {
            statusClass = "status-atencao";
        }

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <strong>${mun.name}</strong> 
                ${mun.is_new ? '<span class="badge" style="background-color: var(--success-color); color: white; padding: 2px 6px; font-size: 9px; margin-left:6px;">NOVO</span>' : ''}
            </td>
            <td class="text-muted">${mun.igr}</td>
            <td>${mun.validity || "Sem Vigência"}</td>
            <td class="${days < 0 ? 'text-red font-bold' : days <= 90 ? 'text-yellow' : 'text-muted'}">${daysText}</td>
            <td><span class="status-pill ${statusClass}">${status}</span></td>
            <td style="text-align:center;">
                <button class="btn btn-outline btn-sm" onclick="openMunicipalityHistoryModal('${mun.name}')" title="Ver histórico semanal do município">
                    <i class="fa-solid fa-clock-rotate-left"></i> Histórico
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    renderPaginationControls(totalPages);
    
    document.getElementById("table-count-label").innerText = `Mostrando ${startIndex + 1} a ${Math.min(startIndex + pageSize, totalRecords)} de ${totalRecords} municípios (Total na base: ${filteredList.length})`;
}

function renderPaginationControls(totalPages) {
    const pagContainer = document.getElementById("table-pagination");
    pagContainer.innerHTML = "";

    if (totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.className = "pagination-btn";
    prevBtn.innerHTML = '<i class="fa-solid fa-angle-left"></i>';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener("click", () => {
        currentPage--;
        filterTableData();
    });
    pagContainer.appendChild(prevBtn);

    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement("button");
        btn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
        btn.innerText = i;
        btn.addEventListener("click", () => {
            currentPage = i;
            filterTableData();
        });
        pagContainer.appendChild(btn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.className = "pagination-btn";
    nextBtn.innerHTML = '<i class="fa-solid fa-angle-right"></i>';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
        currentPage++;
        filterTableData();
    });
    pagContainer.appendChild(nextBtn);
}

// -------------------------------------------------------------
// MUNICIPALITY HISTORY DRILL DOWN MODAL (Auditoria Semanal)
// -------------------------------------------------------------
function openMunicipalityHistoryModal(munName) {
    const history = historyData.munHistory[munName] || [];
    
    document.getElementById("history-modal-title").innerText = munName;
    const timeline = document.getElementById("mun-history-timeline");
    timeline.innerHTML = "";

    if (history.length === 0) {
        timeline.innerHTML = `<p class="text-muted">Nenhum registro histórico encontrado para este município.</p>`;
    } else {
        [...history].reverse().forEach(step => {
            let statusClass = "step-active";
            if (step.status === "Vencido") statusClass = "step-expired";
            else if (step.status === "Próximo do Vencimento") statusClass = "step-warning";

            let eventLabel = "Vigente";
            if (step.event === "entrada") eventLabel = "🎉 Ingresso na Regionalização";
            else if (step.event === "revalidacao") eventLabel = "🔄 Vigência Estendida (Revalidação)";
            else if (step.event === "saida") eventLabel = "❌ Removido da Região";
            else if (step.event === "registro_inicial") eventLabel = "📋 Cadastro Inicial da Série";

            const stepDiv = document.createElement("div");
            stepDiv.className = `mun-history-step ${statusClass}`;
            stepDiv.innerHTML = `
                <div class="mun-history-title">
                    <span>Semana: ${step.reportDate}</span>
                    <span class="status-pill status-${step.status === 'Vigente' ? 'vigente' : step.status === 'Vencido' ? 'vencido' : 'atencao'}">${step.status}</span>
                </div>
                <div class="mun-history-desc">
                    <strong>Ação:</strong> ${eventLabel}<br>
                    <strong>IGR:</strong> ${step.igr}<br>
                    <strong>Vigência:</strong> ${step.validity || "Sem Vigência"}
                </div>
            `;
            timeline.appendChild(stepDiv);
        });
    }

    document.getElementById("history-modal").classList.add("active");
}

// -------------------------------------------------------------
// HISTORICAL LINE & BAR CHARTS (Série Semanal)
// -------------------------------------------------------------
function renderHistoryCharts() {
    renderLineChart();
    renderBarChart();
}

function renderLineChart() {
    const svg = document.getElementById("history-line-chart-svg");
    svg.innerHTML = "";

    const labels = historyData.labels;
    const muns = historyData.munsCount;

    if (labels.length === 0) return;

    const width = 700;
    const height = 260;
    const padding = 40;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const minMuns = Math.min(...muns) - 2;
    const maxMuns = Math.max(...muns) + 2;
    
    const numPoints = labels.length;
    const xStep = numPoints > 1 ? chartWidth / (numPoints - 1) : chartWidth;

    const isDark = document.body.classList.contains("dark-theme");
    const gridColor = isDark ? "#1e293b" : "#cbd5e1";
    const labelColor = isDark ? "#94a3b8" : "#475569";

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding + (chartHeight / gridLines) * i;
        const value = Math.round(maxMuns - ((maxMuns - minMuns) / gridLines) * i);
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", padding);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - padding);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", gridColor);
        line.setAttribute("stroke-dasharray", "4");
        line.setAttribute("stroke-opacity", "0.5");
        svg.appendChild(line);

        const textY = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textY.setAttribute("x", padding - 8);
        textY.setAttribute("y", y + 4);
        textY.setAttribute("text-anchor", "end");
        textY.setAttribute("fill", labelColor);
        textY.setAttribute("font-size", "10px");
        textY.setAttribute("font-family", "var(--font-heading)");
        textY.textContent = value;
        svg.appendChild(textY);
    }

    let pathMunsPoints = [];
    labels.forEach((label, idx) => {
        const x = padding + xStep * idx;
        const val = muns[idx];
        const y = padding + chartHeight - ((val - minMuns) / (maxMuns - minMuns)) * chartHeight;
        pathMunsPoints.push(`${x},${y}`);

        // Rótulo do eixo X como Mês de Competência
        const textX = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textX.setAttribute("x", x);
        textX.setAttribute("y", height - padding + 16);
        textX.setAttribute("text-anchor", "middle");
        textX.setAttribute("fill", labelColor);
        textX.setAttribute("font-size", "10px");
        textX.setAttribute("font-family", "var(--font-heading)");
        textX.textContent = label;
        svg.appendChild(textX);
    });

    const pathLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathLine.setAttribute("class", "chart-line-muns");
    pathLine.setAttribute("d", `M ${pathMunsPoints.join(" L ")}`);
    svg.appendChild(pathLine);

    labels.forEach((label, idx) => {
        const [x, y] = pathMunsPoints[idx].split(",");
        
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("class", "chart-node");
        circle.setAttribute("cx", x);
        circle.setAttribute("cy", y);
        circle.setAttribute("r", "5");
        circle.setAttribute("fill", "#38bdf8");
        circle.setAttribute("stroke", isDark ? "#0b111e" : "#ffffff");
        circle.setAttribute("stroke-width", "2");

        const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "title");
        tooltip.textContent = `Relatório: Competência ${label} (${historyData.dates[idx]})\nMunicípios: ${muns[idx]}\nClique para detalhar este mês.`;
        circle.appendChild(tooltip);

        circle.addEventListener("click", () => {
            document.getElementById("report-selector").value = idx;
            selectReportFromDropdown();
            alert(`Contexto temporal alterado para a competência de: ${label}`);
        });

        svg.appendChild(circle);
    });

    const legendText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    legendText.setAttribute("x", width - padding);
    legendText.setAttribute("y", padding - 15);
    legendText.setAttribute("text-anchor", "end");
    legendText.setAttribute("fill", "var(--primary-color)");
    legendText.setAttribute("font-size", "11px");
    legendText.setAttribute("font-weight", "bold");
    legendText.setAttribute("font-family", "var(--font-heading)");
    legendText.textContent = "📈 Total de Municípios Validados";
    svg.appendChild(legendText);
}

function renderBarChart() {
    const svg = document.getElementById("history-bar-chart-svg");
    svg.innerHTML = "";

    const labels = historyData.labels;
    const entradas = historyData.entradas;
    const saidas = historyData.saidas;

    const width = 350;
    const height = 260;
    const padding = 40;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxVal = Math.max(...entradas, ...saidas, 2) + 1;

    const numGroups = labels.length;
    const groupWidth = chartWidth / numGroups;
    const barWidth = Math.max(4, (groupWidth - 10) / 2);

    const isDark = document.body.classList.contains("dark-theme");
    const gridColor = isDark ? "#1e293b" : "#cbd5e1";
    const labelColor = isDark ? "#94a3b8" : "#475569";

    const gridLines = 3;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding + (chartHeight / gridLines) * i;
        const value = Math.round(maxVal - (maxVal / gridLines) * i);
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", padding);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - padding);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", gridColor);
        line.setAttribute("stroke-opacity", "0.4");
        svg.appendChild(line);

        const textY = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textY.setAttribute("x", padding - 8);
        textY.setAttribute("y", y + 4);
        textY.setAttribute("text-anchor", "end");
        textY.setAttribute("fill", labelColor);
        textY.setAttribute("font-size", "9px");
        textY.setAttribute("font-family", "var(--font-heading)");
        textY.textContent = value;
        svg.appendChild(textY);
    }

    labels.forEach((label, idx) => {
        const groupX = padding + groupWidth * idx;
        
        const entVal = entradas[idx];
        const entHeight = (entVal / maxVal) * chartHeight;
        const entX = groupX + (groupWidth - barWidth * 2 - 2) / 2;
        const entY = padding + chartHeight - entHeight;

        if (entVal > 0) {
            const rectEnt = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rectEnt.setAttribute("x", entX);
            rectEnt.setAttribute("y", entY);
            rectEnt.setAttribute("width", barWidth);
            rectEnt.setAttribute("height", entHeight);
            rectEnt.setAttribute("fill", "var(--success-color)");
            rectEnt.setAttribute("rx", "2");
            
            const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "title");
            tooltip.textContent = `${label}\nEntradas: ${entVal}`;
            rectEnt.appendChild(tooltip);
            svg.appendChild(rectEnt);
        }

        const saiVal = saidas[idx];
        const saiHeight = (saiVal / maxVal) * chartHeight;
        const saiX = entX + barWidth + 2;
        const saiY = padding + chartHeight - saiHeight;

        if (saiVal > 0) {
            const rectSai = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rectSai.setAttribute("x", saiX);
            rectSai.setAttribute("y", saiY);
            rectSai.setAttribute("width", barWidth);
            rectSai.setAttribute("height", saiHeight);
            rectSai.setAttribute("fill", "var(--danger-color)");
            rectSai.setAttribute("rx", "2");

            const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "title");
            tooltip.textContent = `${label}\nSaídas: ${saiVal}`;
            rectSai.appendChild(tooltip);
            svg.appendChild(rectSai);
        }

        const textX = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textX.setAttribute("x", groupX + groupWidth / 2);
        textX.setAttribute("y", height - padding + 16);
        textX.setAttribute("text-anchor", "middle");
        textX.setAttribute("fill", labelColor);
        textX.setAttribute("font-size", "9px");
        textX.setAttribute("font-family", "var(--font-heading)");
        textX.textContent = label;
        svg.appendChild(textX);
    });
}

function renderHistoryRankings() {
    const listStability = document.getElementById("hist-ranking-stability");
    const listVolatility = document.getElementById("hist-ranking-volatility");
    const eventTrail = document.getElementById("hist-event-trail");

    listStability.innerHTML = "";
    listVolatility.innerHTML = "";
    eventTrail.innerHTML = "";

    const rankings = [];
    for (const [name, stats] of Object.entries(historyData.igrStability)) {
        rankings.push({ name, totalChanges: stats.totalChanges });
    }

    const sortedStability = [...rankings].sort((a, b) => a.totalChanges - b.totalChanges);
    const sortedVolatility = [...rankings].sort((a, b) => b.totalChanges - a.totalChanges);

    sortedStability.slice(0, 5).forEach((igr, idx) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div>
                <span class="text-muted" style="margin-right:8px;">#${idx+1}</span>
                <span class="ranking-name">${igr.name}</span>
            </div>
            <span class="ranking-metric text-green">${igr.totalChanges} mud.</span>
        `;
        listStability.appendChild(li);
    });

    sortedVolatility.slice(0, 5).forEach((igr, idx) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div>
                <span class="text-muted" style="margin-right:8px;">#${idx+1}</span>
                <span class="ranking-name">${igr.name}</span>
            </div>
            <span class="ranking-metric text-red">${igr.totalChanges} mud.</span>
        `;
        listVolatility.appendChild(li);
    });

    let trailCount = 0;
    for (let rIdx = db.reports.length - 1; rIdx > 0; rIdx--) {
        const report = db.reports[rIdx];
        const rDate = report.generation_date.split(' ')[0];
        const changes = historyData.reportsChanges[rIdx] || [];

        changes.forEach(change => {
            trailCount++;
            
            let nodeClass = "audit-change";
            if (change.type === "entrada") nodeClass = "audit-entry";
            else if (change.type === "saida") nodeClass = "audit-exit";

            const div = document.createElement("div");
            div.className = `audit-node ${nodeClass}`;
            div.innerHTML = `
                <div class="audit-header">
                    <span>Competência de ${portugueseMonths[parseInt(rDate.split('/')[1]) - 1]} (${rDate})</span>
                    <span style="text-transform: capitalize;">${change.type}</span>
                </div>
                <div class="audit-desc">${change.text}</div>
            `;
            eventTrail.appendChild(div);
        });
    }

    if (trailCount === 0) {
        eventTrail.innerHTML = `<p class="text-muted" style="font-size:12px; text-align:center;">Nenhuma alteração de composição registrada na série histórica.</p>`;
    }

    const totalEntradas = historyData.entradas.reduce((a, b) => a + b, 0);
    const totalSaidas = historyData.saidas.reduce((a, b) => a + b, 0);
    const totalRevalidacoes = historyData.revalidacoes.reduce((a, b) => a + b, 0);

    document.getElementById("hist-kpi-entradas").innerText = totalEntradas;
    document.getElementById("hist-kpi-saidas").innerText = totalSaidas;
    document.getElementById("hist-kpi-revalidacoes").innerText = totalRevalidacoes;
}

// -------------------------------------------------------------
// EXECUTIVE REPORT DOCUMENT & INSIGHTS (Série Mensal)
// -------------------------------------------------------------
function renderExecutiveDocument() {
    document.getElementById("doc-generation-date").innerText = `Emitido em: ${selectedReport.read_date}`;
    const dateParts = selectedReport.generation_date.split(' ')[0].split('/');
    const monthName = portugueseMonths[parseInt(dateParts[1]) - 1];
    document.getElementById("doc-semana-ref").innerText = `Mês de Competência: ${monthName} / ${dateParts[2]}`;
    
    let totalMuns = 0;
    let vigentes = 0;
    let atencao = 0;
    let vencidos = 0;
    
    selectedReport.data.IGRs.forEach(igr => {
        igr.municipalities.forEach(mun => {
            totalMuns++;
            const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
            if (status === "Vigente") vigentes++;
            else if (status === "Próximo do Vencimento") atencao++;
            else if (status === "Vencido") vencidos++;
        });
    });

    document.getElementById("doc-tot-muns").innerText = totalMuns;
    document.getElementById("doc-tot-igrs").innerText = selectedReport.data.IGRs.length;
    document.getElementById("doc-tot-vig").innerText = vigentes;
    document.getElementById("doc-tot-warn").innerText = atencao;
    document.getElementById("doc-tot-venc").innerText = vencidos;

    const changesBox = document.getElementById("doc-weekly-changes-box");
    const summary = selectedReport.summary || {};
    
    const newMuns = summary.new_municipalities || [];
    const remMuns = summary.removed_municipalities || [];
    const newIgrs = summary.new_regions || [];
    const remIgrs = summary.removed_regions || [];
    const valChanges = summary.changed_validity || [];

    let changesHtml = "";
    
    if (newIgrs.length === 0 && newMuns.length === 0 && remMuns.length === 0 && valChanges.length === 0) {
        changesHtml = `<strong>Nenhuma alteração na composição registrada neste mês.</strong>`;
    } else {
        changesHtml = `<ul class="doc-weekly-list">`;
        if (newIgrs.length > 0) {
            changesHtml += `<li><i class="fa-solid fa-circle-plus"></i> Região Turística Registrada: <strong>${newIgrs.join(", ")}</strong></li>`;
        }
        if (newMuns.length > 0) {
            changesHtml += `<li><i class="fa-solid fa-circle-plus"></i> Municípios incluídos no mês: <strong>${newMuns.join(", ")}</strong></li>`;
        }
        if (remMuns.length > 0) {
            changesHtml += `<li><i class="fa-solid fa-circle-minus text-red"></i> Municípios desvinculados no mês: <strong>${remMuns.join(", ")}</strong></li>`;
        }
        if (valChanges.length > 0) {
            changesHtml += `<li><i class="fa-solid fa-clock"></i> Alterações de vigência registradas no mês: <strong>${valChanges.map(x => `${x.name} (até ${x.new_val})`).join(", ")}</strong></li>`;
        }
        changesHtml += `</ul>`;
    }
    changesBox.innerHTML = changesHtml;

    const alertsBox = document.getElementById("doc-alerts-list-box");
    const warningAlerts = selectedReport.alerts ? selectedReport.alerts.filter(a => a.type.includes("VENCIDO") || a.type.includes("BREVE")) : [];
    
    if (warningAlerts.length === 0) {
        alertsBox.innerHTML = `<p class="text-green"><strong>Nenhum risco de regularidade identificado neste mês.</strong> Todos os municípios membros estão ativos.</p>`;
    } else {
        let alertsHtml = `<ul class="doc-danger-list">`;
        warningAlerts.slice(0, 8).forEach(alert => {
            alertsHtml += `<li><i class="fa-solid fa-triangle-exclamation"></i> ${alert.message}</li>`;
        });
        if (warningAlerts.length > 8) {
            alertsHtml += `<li><i class="fa-solid fa-ellipsis"></i> E outros ${warningAlerts.length - 8} municípios em risco listados no painel de inteligência.</li>`;
        }
        alertsHtml += `</ul>`;
        alertsBox.innerHTML = alertsHtml;
    }

    const trendsText = document.getElementById("doc-historical-trends-text");
    
    let criticalIgrName = "Nenhuma";
    let maxCriticalPct = 0;
    
    selectedReport.data.IGRs.forEach(igr => {
        let tot = igr.municipalities.length;
        if (tot > 0) {
            let venc = igr.municipalities.filter(m => getMunicipalityStatus(m.validity, selectedReport.generation_date) === "Vencido").length;
            let pct = venc / tot;
            if (pct > maxCriticalPct) {
                maxCriticalPct = pct;
                criticalIgrName = igr.name;
            }
        }
    });

    const numReports = db.reports.length;
    const totalRevalidacoesTotal = historyData.revalidacoes.reduce((a, b) => a + b, 0);

    let trendDescription = `A auditoria e evolução histórica do Mapa do Turismo ao longo dos últimos <strong>${numReports} meses</strong> mapeou o processamento de <strong>${totalRevalidacoesTotal} revalidações de vigência municipal</strong>. `;
    
    if (maxCriticalPct > 0) {
        trendDescription += `As tendências observadas ao longo dos meses indicam que a IGR <strong>${criticalIgrName}</strong> requer intervenção focada no saneamento burocrático, registrando <strong>${Math.round(maxCriticalPct * 100)}% de descompasso temporal</strong> de vigências regulamentares nesta competência. `;
    } else {
        trendDescription += `Observa-se um perfil de alta estabilidade e adimplência institucional nas IGRs, sem registros de descredenciamento emergencial no mês. `;
    }

    trendDescription += `A equipe da COORDENAÇÃO DE ARTICULAÇÃO E ORDENAMENTO recomenda manter a rotina de varredura ativa mensal para evitar decurso de prazo.`;
    
    trendsText.innerHTML = trendDescription;
}

function copyExecutiveReportText() {
    const doc = document.getElementById("executive-document");
    const text = doc.innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert("Relatório de auditoria mensal copiado com sucesso!");
    });
}

// -------------------------------------------------------------
// MOCK DATA SIMULATION (SEMANA 5)
// -------------------------------------------------------------
function simulateWeek5Carga() {
    const w4 = db.reports[db.reports.length - 1];
    const w5 = JSON.parse(JSON.stringify(w4));
    
    w5.generation_date = "20/07/2026 10:00:00";
    w5.read_date = "21/07/2026 09:30:00";
    w5.file_name = "RELATORIO_COMPOSICAO_20_07_2026_10_00_00.pdf";
    w5.validation_errors = [
        "Região 'Polo Raso da Catarina' foi registrada sem nenhum município associado."
    ];

    w5.data.IGRs.forEach(igr => {
        if (igr.name === "Polo Turístico do Oeste Potiguar") {
            igr.municipalities = igr.municipalities.filter(m => m.name !== "Alexandria");
        }
        if (igr.name === "IGR Rota do Frio") {
            igr.municipalities.forEach(m => {
                if (m.name === "Martins") m.validity = "15/07/2026"; // Venceu
            });
        }
        if (igr.name === "IGR Trairi") {
            igr.municipalities.push({ name: "Passa e Fica", validity: "28/05/2027", is_new: true });
        }
    });

    w5.data.IGRs.push({
        name: "Polo Raso da Catarina",
        validity: "",
        is_new: true,
        municipalities: []
    });

    w5.summary = {
        new_municipalities: ["Passa e Fica"],
        removed_municipalities: ["Alexandria"],
        changed_validity: [
            { name: "Martins", old_val: "15/04/2027", new_val: "15/07/2026" }
        ],
        changed_igr: [],
        new_regions: ["Polo Raso da Catarina"],
        removed_regions: []
    };

    w5.alerts = [
        { "type": "REGIAO_CRIADA", "message": "Nova região registrada no mês de Julho: Polo Raso da Catarina", "target": "Polo Raso da Catarina" },
        { "type": "NOVO_MUNICIPIO", "message": "Novo município adicionado à IGR Trairi: Passa e Fica no mês de Julho", "target": "Passa e Fica", "igr": "IGR Trairi" },
        { "type": "MUNICIPIO_REMOVIDO", "message": "Município desvinculado no mês de Julho: Alexandria (estava no Polo Oeste Potiguar)", "target": "Alexandria", "igr": "Polo Turístico do Oeste Potiguar" },
        { "type": "MUNICIPIO_VENCIDO", "message": "ATENÇÃO: Município VENCIDO na IGR Rota do Frio no mês de Julho: Martins (venceu em 15/07/2026)", "target": "Martins", "igr": "IGR Rota do Frio" }
    ];

    const exists = db.reports.some(r => r.generation_date === w5.generation_date);
    if (!exists) {
        db.reports.push(w5);
    }
}

function getMockDatabase() {
    return window.dashboardData || { reports: [] };
}

// -------------------------------------------------------------
// HELPER FUNCTIONS (DATES & COMPILATION)
// -------------------------------------------------------------
function parseDateStr(str) {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return null;
}

function getDaysRemaining(validityStr, referenceDateStr) {
    if (!validityStr) return -9999;
    const refDate = parseDateStr(referenceDateStr.split(' ')[0]);
    const valDate = parseDateStr(validityStr);
    
    if (!refDate || !valDate) return -9999;
    
    const timeDiff = valDate.getTime() - refDate.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

function getMunicipalityStatus(validityStr, referenceDateStr) {
    const days = getDaysRemaining(validityStr, referenceDateStr);
    if (days === -9999) return "Sem Vigência";
    if (days < 0) return "Vencido";
    if (days <= 90) return "Próximo do Vencimento";
    return "Vigente";
}

// -------------------------------------------------------------
// MISSING FUNCTIONS (RECOVERY)
// -------------------------------------------------------------
function calculateIgrRisk(igr) {
    let total = igr.municipalities.length;
    if (total === 0) return "safe";
    
    let vencidos = 0;
    let atencao = 0;
    
    igr.municipalities.forEach(mun => {
        const status = getMunicipalityStatus(mun.validity, selectedReport.generation_date);
        if (status === "Vencido") vencidos++;
        else if (status === "Próximo do Vencimento") atencao++;
    });
    
    if (vencidos > 0 && (vencidos / total) > 0.3) return "critical";
    if (vencidos > 0 || (vencidos + atencao) / total >= 0.2) return "high";
    if (atencao > 0) return "moderate";
    return "safe";
}

function updateAlertBadges() {
    const badge = document.getElementById("badge-alerts-count");
    if (badge) {
        const count = selectedReport.alerts ? selectedReport.alerts.length : 0;
        badge.innerText = count;
        badge.style.display = count > 0 ? "inline-block" : "none";
    }
}

function exportTableToCSV() {
    let csv = [];
    const rows = document.querySelectorAll("#muns-data-table tr");
    
    for (let i = 0; i < rows.length; i++) {
        const row = [];
        const cols = rows[i].querySelectorAll("td, th");
        
        for (let j = 0; j < cols.length - 1; j++) { // Excluir coluna de histórico
            let text = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, "").trim();
            text = text.replace(/"/g, '""');
            row.push('"' + text + '"');
        }
        csv.push(row.join(";"));
    }
    
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csv.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sismapa_municipios_${selectedReport.generation_date.split(' ')[0].replace(/\//g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
